// fetch-contacts.mjs — LECTURE SEULE
// Construit ta "base chaude" : tous les contacts a qui tu as deja ecrit,
// avec date du dernier contact, dernier sujet et nombre d'echanges.
// Ecrit contacts.json (du moins recemment contacte au plus recent).
// Ne modifie rien, n'envoie rien. Ne telecharge que les entetes (rapide).

import { ImapFlow } from 'imapflow';
import { writeFileSync } from 'node:fs';

const HOST = process.env.IMAP_HOST || 'imap.ionos.fr';
const PORT = Number(process.env.IMAP_PORT || 993);
const USER = (process.env.IMAP_USER || '').toLowerCase();
const PASS = process.env.IMAP_PASSWORD;
const SCAN = Number(process.env.CONTACTS_SCAN || 300);

if (!USER || !PASS) {
  console.error('\n❌ Manque IMAP_USER / IMAP_PASSWORD dans .env.\n');
  process.exit(1);
}

// Adresses a exclure : systeme / no-reply / facturation / support / soi-meme.
const EXCLUDE = /no-?reply|donotreply|notification|invoic|facturation|billing|^support@|mailer-daemon|postmaster|pennylane/i;

function looksLikeSent(box) {
  if (box.specialUse === '\\Sent') return true;
  return /sent|envoy|gesend|enviad/i.test(`${box.path} ${box.name || ''}`);
}

const client = new ImapFlow({ host: HOST, port: PORT, secure: true, auth: { user: USER, pass: PASS }, logger: false });
const map = new Map();

try {
  await client.connect();
  console.log(`✅ Connecte (${USER})`);

  const boxes = await client.list();
  const sent = boxes.find((b) => b.specialUse === '\\Sent') || boxes.find(looksLikeSent);
  if (!sent) { console.error('❌ Dossier "Envoyes" introuvable.'); process.exit(1); }

  const lock = await client.getMailboxLock(sent.path, { readOnly: true });
  try {
    const total = client.mailbox.exists || 0;
    const start = Math.max(1, total - SCAN + 1);
    console.log(`📤 Scan des ${Math.min(SCAN, total)} derniers envois de "${sent.path}"…`);
    for await (const msg of client.fetch(`${start}:${total}`, { envelope: true })) {
      const env = msg.envelope || {};
      const date = env.date ? new Date(env.date).toISOString() : null;
      const subject = env.subject || '';
      for (const r of [...(env.to || []), ...(env.cc || [])]) {
        const email = (r.address || '').toLowerCase();
        if (!email || email === USER || EXCLUDE.test(email)) continue;
        const cur = map.get(email) || {
          email, name: r.name || '', count: 0, lastDate: null, lastSubject: '',
          domain: email.split('@')[1] || '',
        };
        cur.count++;
        if (!cur.lastDate || (date && date > cur.lastDate)) {
          cur.lastDate = date;
          cur.lastSubject = subject;
          if (r.name) cur.name = r.name;
        }
        map.set(email, cur);
      }
    }
  } finally {
    lock.release();
  }
} catch (err) {
  console.error(`\n❌ Erreur : ${err.message}`);
  if (err.response) console.error(`   ${err.response}`);
  process.exitCode = 1;
} finally {
  try { await client.logout(); } catch { /* deja deconnecte */ }
}

const contacts = [...map.values()].sort((a, b) => (a.lastDate || '').localeCompare(b.lastDate || ''));
writeFileSync(new URL('./contacts.json', import.meta.url), JSON.stringify(contacts, null, 2), 'utf8');
console.log(`\n💾 ${contacts.length} contact(s) uniques dans contacts.json.`);
console.log('   (tries du moins recemment contacte au plus recent = les plus "murs" pour une relance)\n');
