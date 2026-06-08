// del-draft.mjs — deplace vers la corbeille les brouillons adresses a DEL_TO (option DEL_SUBJECT).
import { ImapFlow } from 'imapflow';

const TARGET = (process.env.DEL_TO || '').toLowerCase();
const SUBJ = process.env.DEL_SUBJECT || '';
if (!TARGET) { console.error('❌ DEL_TO manquant.'); process.exit(1); }

const client = new ImapFlow({
  host: process.env.IMAP_HOST || 'imap.ionos.fr', port: Number(process.env.IMAP_PORT || 993), secure: true,
  auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD }, logger: false,
});
await client.connect();
const boxes = await client.list();
const drafts = boxes.find((b) => b.specialUse === '\\Drafts') || boxes.find((b) => /draft|brouillon/i.test(`${b.path} ${b.name || ''}`));
const trash = boxes.find((b) => b.specialUse === '\\Trash') || boxes.find((b) => /trash|corbeille|deleted/i.test(`${b.path} ${b.name || ''}`));
const lock = await client.getMailboxLock(drafts.path, { readOnly: false });
const uids = [];
try {
  const total = client.mailbox.exists || 0;
  if (total) for await (const m of client.fetch('1:*', { uid: true, envelope: true })) {
    const to = (m.envelope?.to?.[0]?.address || '').toLowerCase();
    const subj = m.envelope?.subject || '';
    if (to === TARGET && (!SUBJ || subj === SUBJ)) uids.push(m.uid);
  }
  if (uids.length) {
    if (trash) await client.messageMove(uids, trash.path, { uid: true });
    else await client.messageDelete(uids, { uid: true });
  }
} finally { lock.release(); }
await client.logout();
console.log(`🗑️  ${uids.length} brouillon(s) vers ${TARGET} -> corbeille.`);
