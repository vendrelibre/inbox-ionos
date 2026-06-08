// redo-drafts.mjs — recree MES brouillons de relance en HTML (logo + BCC) et envoie les anciens a la corbeille.
// Ne touche QUE les brouillons listes dans redo-list.json (par to+subject exacts).
// Ne recree que ceux ENCORE en brouillon (les envoyes ne sont pas dans Brouillons).

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';

const HOST = process.env.IMAP_HOST || 'imap.ionos.fr';
const PORT = Number(process.env.IMAP_PORT || 993);
const USER = process.env.IMAP_USER;
const PASS = process.env.IMAP_PASSWORD;
const FROM = `Rémi Dumas <${USER}>`;
const BCC = process.env.HUBSPOT_BCC || '';
const LOGO_URL = process.env.SIG_LOGO_URL || 'https://cdn.jsdelivr.net/gh/vendrelibre/inbox-ionos@main/logo-sig.jpg';

if (!USER || !PASS) { console.error('❌ IMAP manquant.'); process.exit(1); }

function toHtml(body) {
  const esc = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5">${esc.replace(/\n/g, '<br>')}<br><br><img src="${LOGO_URL}" width="200" alt="MY SEETY" style="display:block;border:0;outline:none"></div>`;
}

const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: '\r\n' });
async function buildRaw({ to, subject, body }) {
  const info = await composer.sendMail({ from: FROM, to, subject, text: body, html: toHtml(body), ...(BCC ? { bcc: BCC } : {}) });
  return info.message;
}

const list = JSON.parse(readFileSync(new URL('./redo-list.json', import.meta.url), 'utf8'));
const wanted = new Set(list.map((d) => `${d.to.toLowerCase()}|||${d.subject}`));

const client = new ImapFlow({ host: HOST, port: PORT, secure: true, auth: { user: USER, pass: PASS }, logger: false });
await client.connect();
const boxes = await client.list();
const draftsBox = boxes.find((b) => b.specialUse === '\\Drafts') || boxes.find((b) => /draft|brouillon/i.test(`${b.path} ${b.name || ''}`));
const trash = boxes.find((b) => b.specialUse === '\\Trash') || boxes.find((b) => /trash|corbeille|deleted/i.test(`${b.path} ${b.name || ''}`));

const found = [];
const lock = await client.getMailboxLock(draftsBox.path, { readOnly: false });
try {
  const total = client.mailbox.exists || 0;
  const matchUids = [];
  const meta = new Map();
  if (total) for await (const m of client.fetch('1:*', { uid: true, envelope: true })) {
    const to = (m.envelope?.to?.[0]?.address || '').toLowerCase();
    const subject = m.envelope?.subject || '';
    if (wanted.has(`${to}|||${subject}`)) { matchUids.push(m.uid); meta.set(m.uid, { to, subject }); }
  }
  for (const uid of matchUids) {
    const m = await client.fetchOne(uid, { source: true }, { uid: true });
    if (!m || !m.source) continue;
    const mail = await simpleParser(m.source);
    const body = (mail.text || '').trim();
    const md = meta.get(uid);
    if (body) found.push({ uid, to: md.to, subject: md.subject, body });
  }

  const oldUids = [];
  for (const f of found) {
    const raw = await buildRaw(f);
    await client.append(draftsBox.path, raw, ['\\Draft', '\\Seen']);
    oldUids.push(f.uid);
    console.log(`   ♻️  ${f.subject}  →  ${f.to}`);
  }
  if (oldUids.length) {
    if (trash) await client.messageMove(oldUids, trash.path, { uid: true });
    else await client.messageDelete(oldUids, { uid: true });
  }
} finally { lock.release(); }
await client.logout();

console.log(`\n✅ ${found.length} brouillon(s) recree(s) en HTML (logo + BCC), anciens envoyes a la corbeille.`);
console.log(`   ${wanted.size - found.length} non trouve(s) dans Brouillons (deja envoyes ou absents) — non touches.`);
