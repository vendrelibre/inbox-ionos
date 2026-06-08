// organize-inbox.mjs
// Range les newsletters / pubs / notifs de ta BOITE DE RECEPTION dans un dossier dedie.
//
// Par defaut = APERCU (dry-run) : liste ce qui SERAIT range, ne touche a RIEN.
// Pour ranger reellement : mettre APPLY=1 dans l'environnement avant de lancer.
//
// Detection (du plus fiable au moins fiable) :
//   1. en-tete List-Unsubscribe  (signal n°1 des envois de masse / newsletters)
//   2. Precedence: bulk/list/junk
//   3. en-tetes de plateforme d'emailing (Feedback-ID, X-Mailchimp, X-CSA...)
//   4. expediteur type no-reply / newsletter / notifications / marketing

import { ImapFlow } from 'imapflow';

const HOST = process.env.IMAP_HOST || 'imap.ionos.fr';
const PORT = Number(process.env.IMAP_PORT || 993);
const USER = process.env.IMAP_USER;
const PASS = process.env.IMAP_PASSWORD;
const SCAN = Number(process.env.INBOX_SCAN || 150);
const PUB_FOLDER = process.env.PUB_FOLDER || 'Newsletters';
const APPLY = process.env.APPLY === '1';
// Domaines prives a ne jamais ranger (banque, partenaires…) — fournis via env (secret), hors code public.
const SAFELIST_EXTRA = (process.env.SAFELIST_EXTRA || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

if (!USER || !PASS) {
  console.error('\n❌ Manque IMAP_USER / IMAP_PASSWORD dans .env.\n');
  process.exit(1);
}

function classify(msg) {
  const from = (msg.envelope?.from?.[0]?.address || '').toLowerCase();
  // LISTE BLANCHE : relations / docs importants qui portent parfois un List-Unsubscribe
  // mais qu'on NE range JAMAIS (signatures, transferts de fichiers, colis + extras prives via env).
  if (/yousign|wetransfer|transfernow|mondialrelay/i.test(from)) return null;
  if (SAFELIST_EXTRA.some((s) => from.includes(s))) return null;
  const subj = msg.envelope?.subject || '';
  // GARDE-FOU : ne JAMAIS ranger ce qui sent le transactionnel / important,
  // meme si l'en-tete ressemble a une newsletter.
  if (/undelivered|non.?delivered|overdue|impay|facture|invoice|re[çc]u\b|receipt|résiliat|paiement|payment|virement|relevé/i.test(subj)) return null;
  // Signal 100% fiable d'un envoi marketing/newsletter : l'en-tete List-Unsubscribe.
  const h = msg.headers ? msg.headers.toString('utf8') : '';
  if (/^list-unsubscribe:/im.test(h)) return 'newsletter (List-Unsubscribe)';
  return null;
}

const client = new ImapFlow({ host: HOST, port: PORT, secure: true, auth: { user: USER, pass: PASS }, logger: false });
const hits = [];

try {
  await client.connect();
  console.log(`✅ Connecte (${USER})`);
  console.log(APPLY ? '⚙️  MODE APPLIQUE : les mails detectes seront deplaces.\n' : '👀 MODE APERCU (dry-run) : RIEN ne sera deplace.\n');

  const lock = await client.getMailboxLock('INBOX', { readOnly: !APPLY });
  try {
    const total = client.mailbox.exists || 0;
    const start = Math.max(1, total - SCAN + 1);
    console.log(`📥 Scan des ${Math.min(SCAN, total)} mails les plus recents de la boite de reception…\n`);

    for await (const msg of client.fetch(`${start}:${total}`, { uid: true, envelope: true, headers: true })) {
      const reason = classify(msg);
      if (reason) {
        hits.push({
          uid: msg.uid,
          from: msg.envelope?.from?.[0]?.address || '',
          subject: (msg.envelope?.subject || '').slice(0, 65),
          reason,
        });
      }
    }

    console.log(`${hits.length} mail(s) detecte(s) comme newsletter / pub.\n`);
    const byFrom = new Map();
    for (const h of hits) byFrom.set(h.from, (byFrom.get(h.from) || 0) + 1);
    const sorted = [...byFrom.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`Repartition par expediteur (${sorted.length} expediteurs) :`);
    for (const [from, n] of sorted.slice(0, 40)) {
      console.log(`   ${String(n).padStart(4)} ×  ${from}`);
    }
    if (sorted.length > 40) console.log(`   … et ${sorted.length - 40} autre(s) expediteur(s).`);

    if (APPLY && hits.length) {
      const boxes = await client.list();
      if (!boxes.find((b) => b.path === PUB_FOLDER)) {
        await client.mailboxCreate(PUB_FOLDER);
        console.log(`\n📁 Dossier "${PUB_FOLDER}" cree.`);
      }
      await client.messageMove(hits.map((h) => h.uid), PUB_FOLDER, { uid: true });
      console.log(`\n✅ ${hits.length} mail(s) deplace(s) de la boite de reception vers "${PUB_FOLDER}".`);
      console.log('   (reversible : tu peux les redeplacer vers la boite de reception quand tu veux)');
    } else if (!APPLY) {
      console.log(`\n👀 Aperçu uniquement — rien n'a bouge. Donne-moi le OK pour ranger ces mails dans "${PUB_FOLDER}".`);
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
