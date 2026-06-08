// hubspot-sync.mjs — synchronise ta base mail vers HubSpot (contacts + note d'historique).
// LECTURE de ta boite (IMAP) + ECRITURE dans HubSpot (contacts + notes). N'envoie aucun mail.
//
// Variables (env / .env) :
//   LIMIT=5        -> nombre de contacts a synchroniser (test). Mets un grand nombre pour tout passer.
//   SENT_SCAN, INBOX_SCAN -> profondeur de scan IMAP
//   DRY=1         -> n'ecrit rien dans HubSpot, montre juste ce qui serait fait

import { ImapFlow } from 'imapflow';

const HOST = process.env.IMAP_HOST || 'imap.ionos.fr';
const PORT = Number(process.env.IMAP_PORT || 993);
const USER = (process.env.IMAP_USER || '').toLowerCase();
const PASS = process.env.IMAP_PASSWORD;
const TOKEN = process.env.HUBSPOT_TOKEN;
const BASE = process.env.HUBSPOT_BASE || 'https://api.hubapi.com';
const SENT_SCAN = Number(process.env.SENT_SCAN || 500);
const INBOX_SCAN = Number(process.env.INBOX_SCAN || 1500);
const LIMIT = Number(process.env.LIMIT || 5);
const DRY = process.env.DRY === '1';

if (!USER || !PASS) { console.error('❌ Manque IMAP_USER/IMAP_PASSWORD.'); process.exit(1); }
if (!TOKEN || TOKEN.length < 20) { console.error('❌ HUBSPOT_TOKEN absent/invalide.'); process.exit(1); }

const EXCLUDE = /no-?reply|donotreply|notification|invoic|facturation|billing|^support@|mailer-daemon|postmaster|stripe|twilio|calendly|hubspot|wetransfer|transfernow|mondialrelay|sentry|noreply|nepasrepondre/i;
const EXCLUDE_EXTRA = (process.env.EXCLUDE_EXTRA || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const findBox = (boxes, sp, rx) => boxes.find((b) => b.specialUse === sp) || boxes.find((b) => rx.test(`${b.path} ${b.name || ''}`));

function splitName(name, email) {
  if (name && !name.includes('@') && name.toLowerCase() !== email) {
    const p = name.trim().replace(/^"|"$/g, '').split(/\s+/);
    if (p.length >= 2) {
      if (p[0] === p[0].toUpperCase() && p[0].length > 1) return { firstname: p.slice(1).join(' '), lastname: p[0] };
      return { firstname: p[0], lastname: p.slice(1).join(' ') };
    }
    return { firstname: p[0], lastname: '' };
  }
  return { firstname: '', lastname: '' };
}

// ---------- 1) Scan IMAP ----------
const client = new ImapFlow({ host: HOST, port: PORT, secure: true, auth: { user: USER, pass: PASS }, logger: false });
const sent = new Map();
const inbound = new Map();

async function scan(path, limit, cb) {
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    const total = client.mailbox.exists || 0;
    if (!total) return;
    for await (const m of client.fetch(`${Math.max(1, total - limit + 1)}:${total}`, { envelope: true })) cb(m);
  } finally { lock.release(); }
}

await client.connect();
const boxes = await client.list();
const sentBox = findBox(boxes, '\\Sent', /sent|envoy/i);
if (sentBox) await scan(sentBox.path, SENT_SCAN, (m) => {
  const t = m.envelope?.date ? new Date(m.envelope.date).getTime() : 0;
  for (const r of m.envelope?.to || []) {
    const email = (r.address || '').toLowerCase();
    if (!email || email === USER || EXCLUDE.test(email) || EXCLUDE_EXTRA.some((s) => email.includes(s))) continue;
    const cur = sent.get(email) || { email, name: '', dates: [], lastT: 0, lastSubject: '' };
    cur.dates.push(t);
    if (t >= cur.lastT) { cur.lastT = t; cur.lastSubject = m.envelope?.subject || ''; if (r.name) cur.name = r.name; }
    sent.set(email, cur);
  }
});
await scan('INBOX', INBOX_SCAN, (m) => {
  const t = m.envelope?.date ? new Date(m.envelope.date).getTime() : 0;
  const from = (m.envelope?.from?.[0]?.address || '').toLowerCase();
  if (from && t > (inbound.get(from) || 0)) inbound.set(from, t);
});
await client.logout();

// ---------- 2) Construire les fiches ----------
const records = [...sent.values()].map((s) => {
  const lastInbound = inbound.get(s.email) || 0;
  const unanswered = s.dates.filter((d) => d > lastInbound).length;
  const hasReplied = lastInbound > 0;
  let status;
  if (lastInbound > s.lastT) status = 'A répondu — à traiter';
  else if (unanswered >= 3) status = 'Froid (3+ relances sans réponse)';
  else if (unanswered >= 1) status = `À relancer (touche ${unanswered + 1})`;
  else status = 'Contacté';
  const domain = s.email.split('@')[1] || '';
  const { firstname, lastname } = splitName(s.name, s.email);
  return {
    email: s.email, firstname, lastname,
    company: domain, website: domain,
    touchCount: s.dates.length, lastContacted: new Date(s.lastT).toISOString().slice(0, 10),
    hasReplied, lastSubject: s.lastSubject, status,
  };
}).sort((a, b) => (b.lastContacted || '').localeCompare(a.lastContacted || '')).slice(0, LIMIT);

console.log(`\n${records.length} contact(s) a synchroniser${DRY ? ' (DRY — rien ecrit)' : ''} :`);
for (const r of records) console.log(`   • ${r.email.padEnd(40)} ${r.status}`);

if (DRY) { console.log('\n(DRY: stop ici)'); process.exit(0); }

// ---------- 3) Ecriture HubSpot (lots + retry 429) ----------
const STAGE_ENGAGED = process.env.STAGE_ENGAGED || '3273690312'; // "Reunion d'introduction"
const SYNC_DEALS = process.env.SYNC_DEALS === '1';

async function hsReq(method, path, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429) { await new Promise((res) => setTimeout(res, (Number(r.headers.get('Retry-After')) || 2) * 1000)); continue; }
    return { ok: r.ok, status: r.status, body: await r.text() };
  }
  return { ok: false, status: 429, body: 'rate limited' };
}
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// 3a. Upsert contacts par lots de 100
const idByEmail = new Map();
for (const part of chunk(records, 100)) {
  const inputs = part.map((r) => ({ idProperty: 'email', id: r.email, properties: { email: r.email, firstname: r.firstname, lastname: r.lastname, company: r.company, website: r.website } }));
  const up = await hsReq('POST', '/crm/v3/objects/contacts/batch/upsert', { inputs });
  if (!up.ok) { console.error(`\n❌ Upsert KO (HTTP ${up.status}) : ${up.body.slice(0, 300)}`); process.exit(1); }
  for (const r of JSON.parse(up.body).results || []) idByEmail.set((r.properties?.email || '').toLowerCase(), r.id);
}
console.log(`\n✅ ${idByEmail.size} contact(s) créés/mis à jour.`);

// 3b. Note d'historique par contact
const now = Date.now();
let notesOk = 0, notesKo = 0;
if (process.env.SYNC_NOTES !== '0') for (const r of records) {
  const id = idByEmail.get(r.email); if (!id) continue;
  const body = [
    `Statut prospection : ${r.status}`,
    `Dernier contact : ${r.lastContacted}`,
    `Nombre de mails envoyés : ${r.touchCount}`,
    `A déjà répondu : ${r.hasReplied ? 'oui' : 'non'}`,
    `Dernier sujet : ${r.lastSubject || '—'}`,
    '', '(Importé automatiquement depuis la boîte mail Myseety)',
  ].join('\n');
  const note = await hsReq('POST', '/crm/v3/objects/notes', { properties: { hs_note_body: body, hs_timestamp: now }, associations: [{ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] });
  if (note.ok) notesOk++; else { notesKo++; if (notesKo <= 2) console.log(`   ⚠️ Note KO (${note.status}) ${r.email}: ${note.body.slice(0, 150)}`); }
}
console.log(`📝 Notes : ${notesOk} OK${notesKo ? `, ${notesKo} KO` : ''}.`);

// 3c. Deals pour les prospects engages ("A repondu"), sans doublon
if (SYNC_DEALS) {
  let dealsOk = 0, dealsSkip = 0, dealsKo = 0;
  for (const r of records) {
    if (!r.status.startsWith('A répondu')) continue;
    const id = idByEmail.get(r.email); if (!id) continue;
    const assoc = await hsReq('GET', `/crm/v3/objects/contacts/${id}/associations/deals`, null);
    if (assoc.ok && (JSON.parse(assoc.body).results || []).length > 0) { dealsSkip++; continue; }
    const deal = await hsReq('POST', '/crm/v3/objects/deals', {
      properties: { dealname: `${r.company || r.email} — Myseety`, pipeline: 'default', dealstage: STAGE_ENGAGED },
      associations: [{ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }],
    });
    if (deal.ok) dealsOk++; else { dealsKo++; if (dealsKo <= 2) console.log(`   ⚠️ Deal KO (${deal.status}) ${r.email}: ${deal.body.slice(0, 150)}`); }
  }
  console.log(`💼 Deals (prospects engagés) : ${dealsOk} créés, ${dealsSkip} déjà existants, ${dealsKo} KO.`);
}

console.log('\n→ Synchro terminée. Va voir Contacts + Deals dans HubSpot.');
