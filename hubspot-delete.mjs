// hubspot-delete.mjs — supprime des contacts HubSpot par email.
// Usage : DELETE_EMAILS="a@x.com,b@y.com" node --env-file=.env hubspot-delete.mjs

const TOKEN = process.env.HUBSPOT_TOKEN;
const BASE = process.env.HUBSPOT_BASE || 'https://api.hubapi.com';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const emails = (process.env.DELETE_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

if (!TOKEN || !emails.length) { console.error('❌ HUBSPOT_TOKEN ou DELETE_EMAILS manquant.'); process.exit(1); }

for (const email of emails) {
  const r = await fetch(`${BASE}/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`, { headers: H });
  if (!r.ok) { console.log(`   ? introuvable (${r.status}) : ${email}`); continue; }
  const id = (await r.json()).id;
  const del = await fetch(`${BASE}/crm/v3/objects/contacts/${id}`, { method: 'DELETE', headers: H });
  console.log(`   ${del.ok ? '🗑️  supprimé' : '⚠️ KO ' + del.status} : ${email}`);
}
console.log('Fini.');
