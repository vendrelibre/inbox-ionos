// push-drafts.mjs — ECRIT des brouillons dans ton dossier "Brouillons".
//
// ⚠️  N'ENVOIE RIEN. Ajoute seulement des brouillons (flag \Draft) que TU relis
//     et envoies toi-meme depuis ta webmail. Reversible : tu peux les supprimer.
//
// Lit drafts.json : [{ "to": "...", "subject": "...", "body": "..." }, ...]

import { ImapFlow } from 'imapflow';
import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';

const HOST = process.env.IMAP_HOST || 'imap.ionos.fr';
const PORT = Number(process.env.IMAP_PORT || 993);
const USER = process.env.IMAP_USER;
const PASS = process.env.IMAP_PASSWORD;
const FROM = `Rémi Dumas <${USER}>`;
const BCC = process.env.HUBSPOT_BCC || ''; // copie cachee auto -> log HubSpot
const LOGO_URL = process.env.SIG_LOGO_URL || 'https://cdn.jsdelivr.net/gh/vendrelibre/inbox-ionos@main/logo-sig.jpg';

// Version HTML du brouillon = texte + logo via URL hebergee (s'affiche partout).
function toHtml(body) {
  const esc = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5">${esc.replace(/\n/g, '<br>')}<br><br><img src="${LOGO_URL}" width="200" alt="MY SEETY" style="display:block;border:0;outline:none"></div>`;
}

if (!USER || !PASS) {
  console.error('\n❌ Il manque IMAP_USER ou IMAP_PASSWORD dans .env.\n');
  process.exit(1);
}

let drafts;
try {
  drafts = JSON.parse(readFileSync(new URL('./drafts.json', import.meta.url), 'utf8'));
} catch (e) {
  console.error('❌ Impossible de lire drafts.json :', e.message);
  process.exit(1);
}
if (!Array.isArray(drafts) || drafts.length === 0) {
  console.error('❌ drafts.json est vide ou invalide.');
  process.exit(1);
}

// streamTransport = compose le message SANS l'envoyer (on recupere juste le MIME).
const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: '\r\n' });

async function buildRaw({ to, subject, body }) {
  const info = await composer.sendMail({ from: FROM, to, subject, text: body, html: toHtml(body), ...(BCC ? { bcc: BCC } : {}) });
  return info.message; // Buffer du message brut — RIEN n'a ete envoye.
}

function looksLikeDrafts(box) {
  if (box.specialUse === '\\Drafts') return true;
  return /draft|brouillon|entwurf|borrador/i.test(`${box.path} ${box.name || ''}`);
}

const client = new ImapFlow({ host: HOST, port: PORT, secure: true, auth: { user: USER, pass: PASS }, logger: false });

try {
  await client.connect();
  console.log(`✅ Connecte a ${HOST} en tant que ${USER}`);

  const boxes = await client.list();
  const draftsBox = boxes.find((b) => b.specialUse === '\\Drafts') || boxes.find(looksLikeDrafts);
  if (!draftsBox) {
    console.error('\n❌ Dossier "Brouillons" introuvable. Dossiers disponibles :');
    for (const b of boxes) console.error('   - ' + b.path);
    process.exit(1);
  }
  console.log(`📝 Dossier brouillons detecte : "${draftsBox.path}"`);

  let n = 0;
  for (const d of drafts) {
    const raw = await buildRaw(d);
    await client.append(draftsBox.path, raw, ['\\Draft', '\\Seen']);
    n++;
    console.log(`   ✏️  Brouillon cree : "${d.subject}"  →  ${d.to}`);
  }

  console.log(`\n💾 ${n} brouillon(s) ajoute(s) dans "${draftsBox.path}".`);
  console.log('   AUCUN mail envoye. Ouvre ta webmail IONOS > Brouillons pour relire / envoyer. ✋\n');
} catch (err) {
  console.error(`\n❌ Erreur IMAP : ${err.message}`);
  if (err.response) console.error(`   Reponse du serveur : ${err.response}`);
  process.exitCode = 1;
} finally {
  try { await client.logout(); } catch { /* deja deconnecte */ }
}
