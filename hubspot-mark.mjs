// hubspot-mark.mjs — marque un contact HubSpot selon une reponse.
// Usage : MARK_EMAIL="x@y.com" [MARK_STAGE=...] [MARK_NOTE="..."] [MARK_LEAD_STATUS=...] node --env-file=.env hubspot-mark.mjs
// Defaut = "perdu" : deal -> "Fermee perdue" (3273690319) + note + statut UNQUALIFIED.

const TOKEN = process.env.HUBSPOT_TOKEN;
const BASE = process.env.HUBSPOT_BASE || 'https://api.hubapi.com';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const EMAIL = (process.env.MARK_EMAIL || '').toLowerCase();
const STAGE = process.env.MARK_STAGE || '3273690319'; // "Fermee perdue"
const NOTE = process.env.MARK_NOTE || 'Réponse négative reçue : pas intéressé. Sorti de la prospection.';
const LEAD_STATUS = process.env.MARK_LEAD_STATUS || 'UNQUALIFIED';

if (!TOKEN || !EMAIL) { console.error('❌ HUBSPOT_TOKEN ou MARK_EMAIL manquant.'); process.exit(1); }

async function hs(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return { ok: r.ok, status: r.status, body: await r.text() };
}

const c = await hs('GET', `/crm/v3/objects/contacts/${encodeURIComponent(EMAIL)}?idProperty=email`);
if (!c.ok) { console.error(`❌ Contact introuvable (${c.status}) : ${EMAIL}`); process.exit(1); }
const id = JSON.parse(c.body).id;

// statut du lead
await hs('PATCH', `/crm/v3/objects/contacts/${id}`, { properties: { hs_lead_status: LEAD_STATUS } });

// deal -> etape (existant mis a jour, sinon cree)
const assoc = await hs('GET', `/crm/v3/objects/contacts/${id}/associations/deals`);
const deals = assoc.ok ? (JSON.parse(assoc.body).results || []) : [];
if (deals.length) {
  await hs('PATCH', `/crm/v3/objects/deals/${deals[0].id}`, { properties: { dealstage: STAGE } });
  console.log(`   deal existant -> etape ${STAGE}`);
} else {
  await hs('POST', '/crm/v3/objects/deals', { properties: { dealname: `${EMAIL} — Myseety`, pipeline: 'default', dealstage: STAGE }, associations: [{ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }] });
  console.log(`   deal cree en etape ${STAGE}`);
}

// note
await hs('POST', '/crm/v3/objects/notes', { properties: { hs_note_body: NOTE, hs_timestamp: Date.now() }, associations: [{ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }] });

console.log(`✅ ${EMAIL} marqué (statut ${LEAD_STATUS}, deal -> ${STAGE}, note ajoutée).`);
