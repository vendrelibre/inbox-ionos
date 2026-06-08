// fetch-sent.mjs — POC LECTURE SEULE (dossier "Envoyes")
// Lit tes N derniers mails ENVOYES et les enregistre dans sent.json,
// pour que Claude analyse TON style d'ecriture (ton, formules, signatures).
//
// ⚠️  Ouverture en LECTURE SEULE : rien n'est modifie, rien n'est envoye.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { writeFileSync } from 'node:fs';

const HOST = process.env.IMAP_HOST || 'imap.ionos.fr';
const PORT = Number(process.env.IMAP_PORT || 993);
const USER = process.env.IMAP_USER;
const PASS = process.env.IMAP_PASSWORD;
const LIMIT = Number(process.env.SENT_LIMIT || 40);

if (!USER || !PASS) {
  console.error('\n❌ Il manque IMAP_USER ou IMAP_PASSWORD dans .env.\n');
  process.exit(1);
}

// Coupe le corps avant la partie "citee" (l'historique du fil), pour ne garder
// que CE QUE REMI a ecrit (salutation + message + signature).
function topPart(text) {
  if (!text) return '';
  const markers = [
    /\n>.*/,                          // lignes citees ">"
    /\nLe .*a [ée]crit\s*:/i,         // "Le 27/05/2026 ... a ecrit :"
    /\nDe\s*:.*\nEnvoy[ée]\s*:/i,     // bloc Outlook FR "De : / Envoye :"
    /\nOn .*wrote\s*:/i,              // "On ... wrote:"
    /-----\s*Message d'origine/i,
    /________________________________/,
  ];
  let cut = text.length;
  for (const m of markers) {
    const idx = text.search(m);
    if (idx >= 0 && idx < cut) cut = idx;
  }
  return text.slice(0, cut).trim();
}

function looksLikeSent(box) {
  if (box.specialUse === '\\Sent') return true;
  return /sent|envoy|gesend|enviad/i.test(`${box.path} ${box.name || ''}`);
}

const out = [];

const client = new ImapFlow({ host: HOST, port: PORT, secure: true, auth: { user: USER, pass: PASS }, logger: false });

try {
  await client.connect();
  console.log(`✅ Connecte a ${HOST} en tant que ${USER}`);

  const boxes = await client.list();
  const sent = boxes.find((b) => b.specialUse === '\\Sent') || boxes.find(looksLikeSent);
  if (!sent) {
    console.error('\n❌ Dossier "Envoyes" introuvable. Dossiers disponibles :');
    for (const b of boxes) console.error('   - ' + b.path);
    process.exit(1);
  }
  console.log(`📤 Dossier envoyes detecte : "${sent.path}"`);

  const lock = await client.getMailboxLock(sent.path, { readOnly: true });
  try {
    const total = client.mailbox.exists || 0;
    const n = Math.min(LIMIT, total);
    console.log(`   ${total} mail(s) dans "${sent.path}". Lecture des ${n} plus recents…`);
    if (total > 0) {
      const start = Math.max(1, total - LIMIT + 1);
      for await (const msg of client.fetch(`${start}:${total}`, { uid: true, source: true })) {
        const mail = await simpleParser(msg.source);
        const full = (mail.text || (mail.html ? mail.html.replace(/<[^>]+>/g, ' ') : '') || '')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        const top = topPart(full) || full.slice(0, 1200);
        out.push({
          uid: msg.uid,
          date: mail.date ? mail.date.toISOString() : null,
          to: mail.to?.text || '',
          subject: mail.subject || '(sans objet)',
          text: top.slice(0, 1500),
        });
      }
    }
  } finally {
    lock.release();
  }
} catch (err) {
  console.error(`\n❌ Erreur IMAP : ${err.message}`);
  if (err.response) console.error(`   Reponse du serveur : ${err.response}`);
  process.exitCode = 1;
} finally {
  try { await client.logout(); } catch { /* deja deconnecte */ }
}

out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
writeFileSync(new URL('./sent.json', import.meta.url), JSON.stringify(out, null, 2), 'utf8');
console.log(`\n💾 ${out.length} mail(s) envoyes enregistres dans sent.json.`);
console.log("   Rien n'a ete envoye, rien n'a ete modifie dans ta boite. ✋\n");
