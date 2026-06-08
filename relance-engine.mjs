// relance-engine.mjs — LECTURE SEULE
// Le "cerveau" des sequences de relance : detecte les contacts a relancer
// (pas de reponse depuis ta derniere relance) et propose la prochaine touche.
// Ecrit relance-queue.json. N'ecrit AUCUN mail, ne modifie rien.
//
// Regles :
//   - on relance UNIQUEMENT si le contact n'a pas repondu depuis ta derniere relance
//   - delai mini depuis la derniere relance : FOLLOWUP_MIN_DAYS (defaut 4 jours)
//   - on s'arrete apres MAX_TOUCHES relances sans reponse (defaut 3) -> pas de harcelement
//   - on saute ceux qui ont deja un brouillon en attente (dossier Brouillons)
//   - on saute les adresses systeme / fournisseurs / partenaires (liste EXCLUDE)

import { ImapFlow } from 'imapflow';
import { writeFileSync } from 'node:fs';
import nodemailer from 'nodemailer';

const HOST = process.env.IMAP_HOST || 'imap.ionos.fr';
const PORT = Number(process.env.IMAP_PORT || 993);
const USER = (process.env.IMAP_USER || '').toLowerCase();
const PASS = process.env.IMAP_PASSWORD;
const SENT_SCAN = Number(process.env.SENT_SCAN || 500);
const INBOX_SCAN = Number(process.env.INBOX_SCAN || 1500);
const FOLLOWUP_MIN_DAYS = Number(process.env.FOLLOWUP_MIN_DAYS || 4);
const MAX_TOUCHES = Number(process.env.MAX_TOUCHES || 3);

if (!USER || !PASS) {
  console.error('\n❌ Manque IMAP_USER / IMAP_PASSWORD dans .env.\n');
  process.exit(1);
}

// Adresses qu'on ne relance jamais (systeme, compta, banque, fournisseurs, partenaires, SaaS).
const EXCLUDE = /no-?reply|donotreply|notification|invoic|facturation|billing|^support@|mailer-daemon|postmaster|stripe|twilio|calendly|hubspot|wetransfer|transfernow|mondialrelay|sentry|noreply|nepasrepondre/i;
// Domaines prives a exclure (fournisseurs/partenaires/banque/compta) — fournis via env (secret), hors code public.
const EXCLUDE_EXTRA = (process.env.EXCLUDE_EXTRA || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const findBox = (boxes, special, rx) =>
  boxes.find((b) => b.specialUse === special) || boxes.find((b) => rx.test(`${b.path} ${b.name || ''}`));

const client = new ImapFlow({ host: HOST, port: PORT, secure: true, auth: { user: USER, pass: PASS }, logger: false });

const sent = new Map();     // email -> { name, dates:[ms], lastT, lastSubject }
const inbound = new Map();  // email -> dernier ms recu
const queued = new Set();   // emails deja en brouillon

async function scanEnvelopes(path, limit, onMsg) {
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    const total = client.mailbox.exists || 0;
    if (!total) return;
    const start = Math.max(1, total - limit + 1);
    for await (const m of client.fetch(`${start}:${total}`, { envelope: true })) onMsg(m);
  } finally {
    lock.release();
  }
}

try {
  await client.connect();
  console.log(`✅ Connecte (${USER})`);
  const boxes = await client.list();
  const sentBox = findBox(boxes, '\\Sent', /sent|envoy/i);
  const draftsBox = findBox(boxes, '\\Drafts', /draft|brouillon/i);

  // 1) ENVOYES : combien de fois et quand tu as ecrit a chaque contact
  if (sentBox) {
    await scanEnvelopes(sentBox.path, SENT_SCAN, (m) => {
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
  }

  // 2) RECUS : derniere fois que chaque contact t'a ecrit
  await scanEnvelopes('INBOX', INBOX_SCAN, (m) => {
    const t = m.envelope?.date ? new Date(m.envelope.date).getTime() : 0;
    const from = (m.envelope?.from?.[0]?.address || '').toLowerCase();
    if (from && t > (inbound.get(from) || 0)) inbound.set(from, t);
  });

  // 3) BROUILLONS deja en attente -> a ne pas reproposer
  if (draftsBox) {
    await scanEnvelopes(draftsBox.path, 500, (m) => {
      for (const r of m.envelope?.to || []) {
        const email = (r.address || '').toLowerCase();
        if (email) queued.add(email);
      }
    });
  }

  // 4) calcul des relances dues
  const now = Date.now();
  const DAY = 86400000;
  const due = [];
  let repondu = 0, dejaBrouillon = 0, maxAtteint = 0, tropRecent = 0;
  for (const [email, s] of sent) {
    if (queued.has(email)) { dejaBrouillon++; continue; }
    const lastInbound = inbound.get(email) || 0;
    const unanswered = s.dates.filter((d) => d > lastInbound).length; // touches depuis sa derniere reponse
    if (unanswered < 1) { repondu++; continue; }
    if (unanswered >= MAX_TOUCHES) { maxAtteint++; continue; }
    const daysSince = (now - s.lastT) / DAY;
    if (daysSince < FOLLOWUP_MIN_DAYS) { tropRecent++; continue; }
    due.push({
      email,
      name: s.name || '',
      lastOutbound: new Date(s.lastT).toISOString().slice(0, 10),
      daysSince: Math.round(daysSince),
      unansweredTouches: unanswered,
      nextTouch: unanswered + 1,
      hasEverReplied: lastInbound > 0,
      lastSubject: s.lastSubject,
    });
  }
  due.sort((a, b) => b.daysSince - a.daysSince);
  writeFileSync(new URL('./relance-queue.json', import.meta.url), JSON.stringify(due, null, 2), 'utf8');

  console.log(`\n📊 ${sent.size} contacts ecrits, ${inbound.size} expediteurs recus, ${queued.size} deja en brouillon.`);
  console.log(`\n🎯 ${due.length} relance(s) due(s) :\n`);
  for (const d of due.slice(0, 25)) {
    console.log(`   J+${String(d.daysSince).padStart(3)}  touche ${d.nextTouch}  ${d.email.padEnd(42)}${d.hasEverReplied ? ' (a deja echange avec toi)' : ''}`);
  }
  if (due.length > 25) console.log(`   … + ${due.length - 25} autre(s) (voir relance-queue.json).`);
  console.log(`\n   Ecartes : ${repondu} ont repondu · ${dejaBrouillon} deja en brouillon · ${maxAtteint} ont atteint ${MAX_TOUCHES} touches · ${tropRecent} trop recents.`);

  // Brief optionnel depose dans la boite de reception (mode cloud / quotidien)
  if (process.env.BRIEF_TO_INBOX === '1' && due.length) {
    const top = due.slice(0, 15);
    const lignes = top.map((d) => `• touche ${d.nextTouch} — ${d.email}${d.name && d.name !== d.email ? ` (${d.name})` : ''}${d.lastSubject ? ` — ${d.lastSubject}` : ''}  [relancé il y a ${d.daysSince} j]`);
    const corps = [
      'Bonjour Rémi,', '',
      'Brief du jour de ton assistant boîte :', '',
      '📥 Tri : les newsletters du jour ont été rangées dans le dossier « Newsletters ».', '',
      `🎯 ${due.length} relance(s) due(s). Top ${top.length} à traiter :`, '',
      ...lignes, '',
      '👉 Pour que je les rédige (en brouillon, dans ton style), dis-moi « prépare les relances ».', '',
      '— Ton assistant',
    ].join('\n');
    const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: '\r\n' });
    const info = await composer.sendMail({
      from: `Assistant Myseety <${USER}>`,
      to: USER,
      subject: `📋 Brief relances — ${due.length} dues aujourd'hui`,
      text: corps,
    });
    await client.append('INBOX', info.message, []); // [] = laisse le message non lu
    console.log(`\n📬 Brief depose dans la boite (${due.length} relances dues).`);
  }
} catch (err) {
  console.error(`\n❌ Erreur : ${err.message}`);
  if (err.response) console.error(`   ${err.response}`);
  process.exitCode = 1;
} finally {
  try { await client.logout(); } catch { /* deja deconnecte */ }
}
