// peek-sig.mjs — inspecte les derniers mails envoyes pour trouver le logo de signature.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const client = new ImapFlow({
  host: process.env.IMAP_HOST || 'imap.ionos.fr', port: Number(process.env.IMAP_PORT || 993), secure: true,
  auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD }, logger: false,
});
await client.connect();
const boxes = await client.list();
const sent = boxes.find((b) => b.specialUse === '\\Sent') || boxes.find((b) => /sent|envoy/i.test(b.path));
const lock = await client.getMailboxLock(sent.path, { readOnly: true });
try {
  const total = client.mailbox.exists || 0;
  const start = Math.max(1, total - 5);
  for await (const m of client.fetch(`${start}:${total}`, { uid: true, source: true })) {
    const mail = await simpleParser(m.source);
    const html = mail.html || '';
    const imgs = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((x) => x[1]);
    const atts = (mail.attachments || []).map((a) => `${a.filename || '(sans nom)'} | cid=${a.cid || '-'} | ${a.contentType} | ${a.size}o`);
    console.log(`\n=== ${mail.subject || '(sans objet)'} ===`);
    console.log('  images <img src>:', imgs.length ? imgs.map((s) => s.slice(0, 90)) : '(aucune)');
    console.log('  pieces jointes  :', atts.length ? atts : '(aucune)');
  }
} finally { lock.release(); }
await client.logout();
