// triage-replies.mjs — lit les reponses entrantes, les classe et agit.
//   🔴 NEGATIF  -> contact "perdu" dans HubSpot (idempotent) + liste do-not-contact
//   ⚪ OOO       -> ignore (absence / reponse auto)
//   🟢 POSITIF / ❔ NEUTRE -> listes pour Remi (aucune action auto)
// Lit la boite (IMAP) + ecrit dans HubSpot (statut/deal/note). N'ENVOIE aucun mail.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { readFileSync, writeFileSync } from 'node:fs';

const HOST = process.env.IMAP_HOST || 'imap.ionos.fr';
const PORT = Number(process.env.IMAP_PORT || 993);
const USER = (process.env.IMAP_USER || '').toLowerCase();
const PASS = process.env.IMAP_PASSWORD;
const TOKEN = process.env.HUBSPOT_TOKEN;
const BASE = process.env.HUBSPOT_BASE || 'https://api.hubapi.com';
const SCAN = Number(process.env.INBOX_SCAN || 150);
const LOST_STAGE = process.env.MARK_STAGE || '3273690319'; // "Fermee perdue"
const H = TOKEN ? { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } : null;

if (!USER || !PASS) { console.error('❌ IMAP_USER / IMAP_PASSWORD manquant.'); process.exit(1); }

const EXCLUDE = /no-?reply|donotreply|notification|invoic|facturation|billing|^support@|mailer-daemon|postmaster|stripe|twilio|calendly|hubspot|wetransfer|transfernow|mondialrelay|sentry|noreply|nepasrepondre/i;
const EXCLUDE_EXTRA = (process.env.EXCLUDE_EXTRA || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const NEG = /pas\s+int[eé]ress|ne sommes pas int[eé]ress|n'?[eê]tes pas int[eé]ress|non merci|aucun int[eé]r[eê]t|ne souhait|ne donnerons? pas suite|d[eé]sinscri|me retirer|retirez[- ]?moi|supprim.{0,15}liste|ne plus.{0,15}contact|merci de ne plus/i;
const OOO = /absent|cong[eé]s|vacances|de retour le|r[eé]ponse automatique|out of office|absence|actuellement absent|en d[eé]placement|serai de retour/i;
const POS = /int[eé]ress[eé]|avec plaisir|volontiers|rappel|recontact|disponible|ok pour|[eé]chang|prenons|cr[eé]neau|rendez[- ]?vous|un appel/i;

function classify(text) {
  const t = (text || '').toLowerCase();
  if (NEG.test(t)) return 'negatif';
  if (OOO.test(t)) return 'ooo';
  if (POS.test(t)) return 'positif';
  return 'neutre';
}

async function hs(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, body: await r.text() };
}

// idempotent : ne re-marque pas un contact deja UNQUALIFIED (pas de note en double).
async function markLost(email) {
  const c = await hs('GET', `/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email&properties=hs_lead_status`);
  if (!c.ok) return 'absent du CRM';
  const data = JSON.parse(c.body);
  if (data.properties?.hs_lead_status === 'UNQUALIFIED') return 'deja perdu';
  const id = data.id;
  await hs('PATCH', `/crm/v3/objects/contacts/${id}`, { properties: { hs_lead_status: 'UNQUALIFIED' } });
  const assoc = await hs('GET', `/crm/v3/objects/contacts/${id}/associations/deals`);
  const deals = assoc.ok ? (JSON.parse(assoc.body).results || []) : [];
  if (deals.length) await hs('PATCH', `/crm/v3/objects/deals/${deals[0].id}`, { properties: { dealstage: LOST_STAGE } });
  else await hs('POST', '/crm/v3/objects/deals', { properties: { dealname: `${email} — Myseety`, pipeline: 'default', dealstage: LOST_STAGE }, associations: [{ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }] });
  await hs('POST', '/crm/v3/objects/notes', { properties: { hs_note_body: 'Réponse négative reçue : pas intéressé. Sorti de la prospection.', hs_timestamp: Date.now() }, associations: [{ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] });
  return 'marqué perdu';
}

// 1. scanner la boite : dernier mail entrant par expediteur
const client = new ImapFlow({ host: HOST, port: PORT, secure: true, auth: { user: USER, pass: PASS }, logger: false });
const byFrom = new Map();
await client.connect();
const lock = await client.getMailboxLock('INBOX', { readOnly: true });
try {
  const total = client.mailbox.exists || 0;
  const start = Math.max(1, total - SCAN + 1);
  if (total) for await (const m of client.fetch(`${start}:${total}`, { uid: true, envelope: true, source: true })) {
    const from = (m.envelope?.from?.[0]?.address || '').toLowerCase();
    if (!from || from === USER || EXCLUDE.test(from) || EXCLUDE_EXTRA.some((s) => from.includes(s))) continue;
    const t = m.envelope?.date ? new Date(m.envelope.date).getTime() : 0;
    if (!byFrom.has(from) || t > byFrom.get(from).t) {
      const mail = await simpleParser(m.source);
      const body = (mail.text || (mail.html ? mail.html.replace(/<[^>]+>/g, ' ') : '') || '').slice(0, 2000);
      byFrom.set(from, { t, from, subject: m.envelope?.subject || '', body });
    }
  }
} finally { lock.release(); }
await client.logout();

// 2. classer + agir
const res = { negatif: [], positif: [], ooo: [], neutre: [] };
const negatives = [];
for (const [from, m] of byFrom) {
  const cls = classify(m.body);
  res[cls].push(m);
  if (cls === 'negatif' && H) {
    const r = await markLost(from);
    negatives.push(from);
    console.log(`   🔴 ${from}  -> ${r}`);
  }
}

// 3. liste do-not-contact (local)
if (negatives.length) {
  let list = [];
  try { list = JSON.parse(readFileSync(new URL('./do-not-contact.json', import.meta.url), 'utf8')); } catch { /* */ }
  const set = new Set(list.map((e) => String(e).toLowerCase()));
  for (const e of negatives) set.add(e);
  writeFileSync(new URL('./do-not-contact.json', import.meta.url), JSON.stringify([...set], null, 2), 'utf8');
}

// 4. resume
console.log(`\n📊 Tri des reponses (${byFrom.size} expediteurs recents analyses) :`);
console.log(`   🔴 ${res.negatif.length} negative(s) -> marquees perdues + ne plus relancer`);
console.log(`   ⚪ ${res.ooo.length} absence(s)/OOO -> ignorees`);
console.log(`   🟢 ${res.positif.length} positive(s)/interessee(s) -> A TRAITER :`);
for (const m of res.positif) console.log(`      • ${m.from}  (${(m.subject || '').slice(0, 50)})`);
if (res.neutre.length) {
  console.log(`   ❔ ${res.neutre.length} a verifier (ni claire pos, ni neg) :`);
  for (const m of res.neutre.slice(0, 20)) console.log(`      • ${m.from}  (${(m.subject || '').slice(0, 50)})`);
}
