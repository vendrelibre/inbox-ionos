// redo-with-maps.mjs — recree les brouillons de relance en HTML AVEC la carte d'audience en haut.
// Ne touche que les brouillons dont l'email est dans maps-index.json ET le couple to+subject dans redo-list.json.
// Deplace les anciens vers la corbeille.

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
const MAPS_BASE = process.env.MAPS_BASE || 'https://cdn.jsdelivr.net/gh/vendrelibre/inbox-ionos@main/maps/';

if (!USER || !PASS) { console.error('❌ IMAP manquant.'); process.exit(1); }

const idx = JSON.parse(readFileSync(new URL('./maps-index.json', import.meta.url), 'utf8'));   // email -> hash
const redo = JSON.parse(readFileSync(new URL('./redo-list.json', import.meta.url), 'utf8'));
const isMine = new Set(redo.map((d) => `${d.to.toLowerCase()}|||${d.subject}`));

function toHtml(body, mapUrl) {
  const esc = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const header = mapUrl ? `<img src="${mapUrl}" width="600" alt="Votre public, cartographié" style="display:block;border:0;max-width:100%;border-radius:8px;margin-bottom:16px">` : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5">${header}${esc.replace(/\n/g, '<br>')}<br><br><img src="${LOGO_URL}" width="200" alt="MY SEETY" style="display:block;border:0"></div>`;
}

const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: '\r\n' });
async function buildRaw({ to, subject, body, mapUrl }) {
  const info = await composer.sendMail({ from: FROM, to, subject, text: body, html: toHtml(body, mapUrl), ...(BCC ? { bcc: BCC } : {}) });
  return info.message;
}

const client = new ImapFlow({ host: HOST, port: PORT, secure: true, auth: { user: USER, pass: PASS }, logger: false });
await client.connect();
const boxes = await client.list();
const draftsBox = boxes.find((b) => b.specialUse === '\\Drafts') || boxes.find((b) => /draft|brouillon/i.test(`${b.path} ${b.name || ''}`));
const trash = boxes.find((b) => b.specialUse === '\\Trash') || boxes.find((b) => /trash|corbeille|deleted/i.test(`${b.path} ${b.name || ''}`));

const found = [];
const lock = await client.getMailboxLock(draftsBox.path, { readOnly: false });
try {
  const total = client.mailbox.exists || 0;
  const hits = [];
  if (total) for await (const m of client.fetch('1:*', { uid: true, envelope: true })) {
    const to = (m.envelope?.to?.[0]?.address || '').toLowerCase();
    const subject = m.envelope?.subject || '';
    if (isMine.has(`${to}|||${subject}`) && idx[to]) hits.push({ uid: m.uid, to, subject });
  }
  for (const h of hits) {
    const m = await client.fetchOne(h.uid, { source: true }, { uid: true });
    if (!m || !m.source) continue;
    const mail = await simpleParser(m.source);
    const body = (mail.text || '').trim();
    if (body) found.push({ ...h, body, mapUrl: `${MAPS_BASE}${idx[h.to]}.jpg` });
  }

  const oldUids = [];
  for (const f of found) {
    const raw = await buildRaw(f);
    await client.append(draftsBox.path, raw, ['\\Draft', '\\Seen']);
    oldUids.push(f.uid);
    console.log(`   🗺️  ${f.subject}  →  ${f.to}`);
  }
  if (oldUids.length) {
    if (trash) await client.messageMove(oldUids, trash.path, { uid: true });
    else await client.messageDelete(oldUids, { uid: true });
  }
} finally { lock.release(); }
await client.logout();
console.log(`\n✅ ${found.length} brouillon(s) recree(s) AVEC carte d'audience, anciens a la corbeille.`);
