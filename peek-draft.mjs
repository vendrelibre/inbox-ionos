// peek-draft.mjs — inspecte les brouillons vers PEEK_TO : présence carte + logo, URLs, doublons.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const HOST = process.env.IMAP_HOST || 'imap.ionos.fr';
const PORT = Number(process.env.IMAP_PORT || 993);
const USER = process.env.IMAP_USER;
const PASS = process.env.IMAP_PASSWORD;
const TO = (process.env.PEEK_TO || '').toLowerCase();

const client = new ImapFlow({ host: HOST, port: PORT, secure: true, auth: { user: USER, pass: PASS }, logger: false });
await client.connect();
const boxes = await client.list();
const draftsBox = boxes.find((b) => b.specialUse === '\\Drafts') || boxes.find((b) => /draft|brouillon/i.test(`${b.path} ${b.name || ''}`));

const lock = await client.getMailboxLock(draftsBox.path, { readOnly: true });
try {
  const hits = [];
  for await (const m of client.fetch('1:*', { uid: true, envelope: true })) {
    const to = (m.envelope?.to?.[0]?.address || '').toLowerCase();
    if (to === TO) hits.push({ uid: m.uid, subject: m.envelope?.subject || '' });
  }
  console.log(`\n${hits.length} brouillon(s) vers ${TO} :`);
  for (const h of hits) {
    const m = await client.fetchOne(h.uid, { source: true }, { uid: true });
    const mail = await simpleParser(m.source);
    const html = mail.html || '';
    const hasCid = /cid:visuel/i.test(html);
    const atts = (mail.attachments || []).map((a) => `${a.filename || a.cid} (${Math.round((a.size || 0) / 1024)} Ko, cid=${a.cid || '-'})`);
    const hasLogo = /logo-sig/i.test(html);
    console.log(`\n  • uid=${h.uid}  "${h.subject}"`);
    console.log(`     HTML:${html ? 'oui' : 'NON'} | <img cid:visuel>:${hasCid ? 'OUI' : 'non'} | logo:${hasLogo ? 'oui' : 'non'}`);
    const rawHasCid = (m.source ? m.source.toString('latin1') : '').includes('cid:visuel');
    console.log(`     pieces jointes inline: ${atts.length ? atts.join(', ') : '(aucune)'}`);
    console.log(`     source brute contient src="cid:visuel": ${rawHasCid ? 'OUI ✅' : 'NON ❌'}`);
  }
} finally { lock.release(); }
await client.logout();
