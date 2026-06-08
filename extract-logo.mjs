// extract-logo.mjs — recupere l'image de signature d'un mail envoye et la sauve en logo.jpg
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { writeFileSync } from 'node:fs';

const client = new ImapFlow({
  host: process.env.IMAP_HOST || 'imap.ionos.fr', port: Number(process.env.IMAP_PORT || 993), secure: true,
  auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD }, logger: false,
});
await client.connect();
const boxes = await client.list();
const sent = boxes.find((b) => b.specialUse === '\\Sent') || boxes.find((b) => /sent|envoy/i.test(b.path));
const lock = await client.getMailboxLock(sent.path, { readOnly: true });
let saved = false;
try {
  const total = client.mailbox.exists || 0;
  for (let seq = total; seq >= Math.max(1, total - 10) && !saved; seq--) {
    const m = await client.fetchOne(seq, { source: true });
    if (!m) continue;
    const mail = await simpleParser(m.source);
    const img = (mail.attachments || []).find((a) => /image\//.test(a.contentType || ''));
    if (img && img.content) {
      writeFileSync(new URL('./logo.jpg', import.meta.url), img.content);
      console.log(`✅ logo.jpg sauve (${img.filename}, ${img.size} octets) depuis "${mail.subject}"`);
      saved = true;
    }
  }
} finally { lock.release(); }
await client.logout();
if (!saved) console.log('❌ aucune image trouvee dans les derniers envois.');
