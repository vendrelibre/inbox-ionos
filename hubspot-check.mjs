// hubspot-check.mjs — verifie HUBSPOT_TOKEN, teste la connexion, lit le pipeline deals.
// N'affiche JAMAIS la cle.

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN || TOKEN.length < 20 || TOKEN.includes('<')) {
  console.error('❌ HUBSPOT_TOKEN absent ou invalide dans .env (placeholder non remplace ?).');
  process.exit(1);
}
const BASE = process.env.HUBSPOT_BASE || 'https://api.hubapi.com';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function get(path) {
  const r = await fetch(BASE + path, { headers: H });
  return { ok: r.ok, status: r.status, body: await r.text() };
}

// 1. Auth + lecture contacts
const c = await get('/crm/v3/objects/contacts?limit=1');
if (!c.ok) {
  console.error(`❌ Connexion KO (HTTP ${c.status}).`);
  console.error('   ' + c.body.slice(0, 300));
  if (c.status === 401) console.error('   → cle invalide, ou scope crm.objects.contacts.read manquant.');
  process.exit(1);
}
console.log('✅ Connexion HubSpot OK (lecture contacts autorisee).');

// 2. Pipeline(s) deals + etapes
const p = await get('/crm/v3/pipelines/deals');
if (p.ok) {
  const pj = JSON.parse(p.body);
  for (const pl of pj.results || []) {
    console.log(`\n📊 Pipeline deals "${pl.label}" (id=${pl.id}) :`);
    for (const st of (pl.stages || []).slice().sort((a, b) => a.displayOrder - b.displayOrder)) {
      console.log(`   - ${st.label}  (stageId=${st.id})`);
    }
  }
} else {
  console.log(`\n⚠️ Pipeline deals illisible (HTTP ${p.status}) — scope crm.schemas.deals.read / crm.objects.deals.read manquant ?`);
  console.log('   ' + p.body.slice(0, 200));
}

// 3. Test ecriture deals dispo ? (juste un GET du schema, pas d'ecriture ici)
const d = await get('/crm/v3/objects/deals?limit=1');
console.log(`\nLecture deals : ${d.ok ? 'OK ✅' : 'KO ❌ (' + d.status + ')'}`);
console.log('\n→ Pret pour construire la synchro.');
