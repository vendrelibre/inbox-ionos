// fetch-emails.mjs — POC LECTURE SEULE
// Se connecte a ta boite IONOS, lit les N derniers mails de la boite de reception,
// et les enregistre dans emails.json (en local, sur ton PC).
//
// ⚠️  GARANTIES DE SECURITE :
//   - La boite est ouverte en LECTURE SEULE (mode EXAMINE) : le serveur ne peut
//     modifier aucun flag. Rien n'est marque comme lu, rien n'est deplace.
//   - Aucun mail n'est envoye (pas de SMTP ici).
//   - Tes identifiants sont lus depuis .env (jamais ecrits en dur dans ce fichier).

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { writeFileSync } from 'node:fs';

const HOST = process.env.IMAP_HOST || 'imap.ionos.fr';
const PORT = Number(process.env.IMAP_PORT || 993);
const USER = process.env.IMAP_USER;
const PASS = process.env.IMAP_PASSWORD;
const LIMIT = Number(process.env.FETCH_LIMIT || 20);

if (!USER || !PASS) {
  console.error('\n❌ Il manque IMAP_USER ou IMAP_PASSWORD dans le fichier .env.');
  console.error('   Copie .env.example en .env, remplis-le, puis relance.\n');
  process.exit(1);
}

const client = new ImapFlow({
  host: HOST,
  port: PORT,
  secure: true,
  auth: { user: USER, pass: PASS },
  logger: false,
});

const out = [];

try {
  await client.connect();
  console.log(`✅ Connecte a ${HOST} en tant que ${USER}`);

  // Ouverture en LECTURE SEULE : aucun flag modifie, rien marque comme lu.
  const lock = await client.getMailboxLock('INBOX', { readOnly: true });
  try {
    const total = client.mailbox.exists || 0;
    const n = Math.min(LIMIT, total);
    console.log(`📥 ${total} message(s) dans la boite de reception. Lecture des ${n} plus recents…`);

    if (total > 0) {
      const start = Math.max(1, total - LIMIT + 1);
      for await (const msg of client.fetch(`${start}:${total}`, { uid: true, source: true })) {
        const mail = await simpleParser(msg.source);
        const body = (mail.text || (mail.html ? mail.html.replace(/<[^>]+>/g, ' ') : '') || '')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
          .slice(0, 4000);
        out.push({
          uid: msg.uid,
          date: mail.date ? mail.date.toISOString() : null,
          from: mail.from?.text || '',
          to: mail.to?.text || '',
          subject: mail.subject || '(sans objet)',
          body,
        });
      }
    }
  } finally {
    lock.release();
  }
} catch (err) {
  console.error(`\n❌ Erreur IMAP : ${err.message}`);
  if (err.response) console.error(`   Reponse du serveur : ${err.response}`);
  if (err.serverResponseCode) console.error(`   Code serveur : ${err.serverResponseCode}`);
  const authish = err.authenticationFailed
    || /auth|login|credential|AUTHENTICATIONFAILED/i.test(`${err.message} ${err.serverResponseCode || ''} ${err.response || ''}`);
  if (authish) {
    console.error('\n   → AUTHENTIFICATION REFUSEE par IONOS. Pistes, par ordre de probabilite :');
    console.error('     1) Le mot de passe dans .env est faux ou encore le placeholder.');
    console.error('     2) La double authentification IONOS est active → cree un "mot de passe applicatif".');
    console.error('     3) L\'acces IMAP est desactive sur cette boite (a activer dans l\'espace IONOS).');
  }
  if (/ENOTFOUND|getaddrinfo|lookup|ECONNREFUSED|ETIMEDOUT/i.test(err.message)) {
    console.error('   → Serveur injoignable : mets IMAP_HOST=imap.ionos.com dans .env (au lieu de .fr) et relance.');
  }
  process.exitCode = 1;
} finally {
  try { await client.logout(); } catch { /* deja deconnecte */ }
}

out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
writeFileSync(new URL('./emails.json', import.meta.url), JSON.stringify(out, null, 2), 'utf8');
console.log(`\n💾 ${out.length} mail(s) enregistres dans emails.json.`);
console.log("   Rien n'a ete envoye, rien n'a ete modifie dans ta boite. ✋\n");
