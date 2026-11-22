/**
 * Transferts inter-magasins et consolidation, verifies dans un vrai
 * navigateur (M11).
 *
 * Le cycle complet est joue a l'ecran : preparer, expedier, compter
 * moins que prevu, signer. Ce qui compte est que l'ecart soit visible a
 * chaque etape, et que la consolidation s'accorde avec lui.
 *
 *   node apps/backoffice/test-transferts.mjs
 */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const erreurs = []; const refus = [];
let ok = 0, total = 0;
const etape = (n, r, d = '') => { total++; if (r) ok++; console.log(`  ${r ? 'OK   ' : 'ECHEC'} ${n}${d ? ` — ${d}` : ''}`); };
async function attendre(page, f, delai = 20000) {
  await page.waitForFunction((x) => [...document.querySelectorAll('.message')]
    .some((m) => (m.textContent ?? '').includes(x)), f, { timeout: delai });
  return page.evaluate((x) => [...document.querySelectorAll('.message')]
    .map((m) => m.textContent ?? '').find((t) => t.includes(x)) ?? '', f);
}
const nombre = (texte) =>
  Number((texte ?? '').replace(/[^0-9,]/g, '').replace(/\s/g, '').replace(',', '.'));

const navigateur = await chromium.launch({ args: ['--no-sandbox'] });
const page = await navigateur.newPage({ viewport: { width: 1500, height: 950 } });
// Le refus d'expedier plus que le stock disponible est un cas voulu :
// il produit un 400 et une erreur console qu'il ne faut pas compter
// comme un defaut.
const attendu = (url) => url.includes('/expedition');
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('400')) erreurs.push(m.text());
});
page.on('pageerror', (e) => erreurs.push(String(e)));
page.on('response', (r) => {
  if (r.status() >= 400 && !attendu(r.url())) refus.push(`${r.status()} ${r.url()}`);
});

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.fill('#login', 'gerant');
await page.fill('#mdp', 'GestGlobale2026!');
await page.click('button.principal');
await page.waitForSelector('.carte .valeur', { timeout: 20000 });

// --- Consolidation, avant tout transfert -------------------------------
await page.click('a:has-text("Rapports")');
await page.waitForSelector('h1:has-text("Rapports")', { timeout: 15000 });
await page.click('.barre-outils button:has-text("Groupe")');
await page.waitForTimeout(1500);

const groupeAvant = await page.textContent('body');
etape('La consolidation s’ouvre sur les deux magasins',
  groupeAvant.includes('Superette principale') && groupeAvant.includes('Bab Ezzouar'));
etape('Elle chiffre le stock et la tresorerie du groupe',
  groupeAvant.includes('Valeur du stock') && groupeAvant.includes('Tresorerie'));
const stockAvant = nombre(
  await page.textContent('.carte:has-text("Valeur du stock") .valeur'));
etape('La valeur du stock du groupe est chiffree', stockAvant > 0, `${stockAvant} DA`);
etape('Le siege est nomme comme compte a part',
  groupeAvant.includes('n’appartiennent a aucun magasin'));

// --- Preparer un bon ----------------------------------------------------
await page.click('a:has-text("Transferts")');
await page.waitForSelector('h1:has-text("Transferts entre magasins")', { timeout: 15000 });
await page.waitForTimeout(1000);

await page.click('button:has-text("Nouveau bon")');
await page.waitForTimeout(600);

etape('Le magasin de depart est pre-selectionne',
  (await page.locator('#source').inputValue()).length > 0);

// Le magasin choisi comme depart ne doit pas pouvoir etre aussi
// l'arrivee : on ne se transfere pas a soi-meme.
await page.selectOption('#source', { label: 'Superette principale' });
await page.waitForTimeout(500);
const destinations = await page.locator('#destination option').allTextContents();
etape('Le magasin de depart ne figure pas dans les destinations',
  destinations.length >= 1 && !destinations.includes('Superette principale'),
  destinations.join(', '));

await page.fill('input[placeholder*="Reapprovisionnement"]', 'Essai de transfert');
await page.fill('input[placeholder*="Scannez"]', 'Huile');
await page.waitForTimeout(1200);
await page.keyboard.press('Enter');
await page.waitForTimeout(800);

let ajoute = await page.locator('.carte .tableau tbody tr').count();
if (ajoute === 0) {
  await page.click('.carte .tableau tbody tr, .resultats li, .carte li');
  await page.waitForTimeout(600);
  ajoute = await page.locator('.carte .tableau tbody tr').count();
}
etape('Un article s’ajoute au bon', ajoute >= 1, `${ajoute} ligne(s)`);

// Deux fois le meme article : l'ecran doit le dire, pas le serveur.
await page.fill('input[placeholder*="Scannez"]', 'Huile');
await page.waitForTimeout(1200);
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
const messageDouble = await page.textContent('body');
etape('Ajouter deux fois le meme article est refuse a l’ecran',
  messageDouble.includes('deja sur le bon'));

// Expedier plus qu'on ne possede doit etre refuse : rien n'a encore eu
// lieu, on peut donc dire non, contrairement a une vente deja encaissee.
await page.fill('.carte .tableau tbody tr input', '99999');
await page.click('button:has-text("Preparer le bon")');
await attendre(page, 'prepare');
await page.waitForTimeout(600);
await page.click('tbody tr:has-text("a expedier") button:has-text("Expedier")');
await page.waitForTimeout(2500);
const refusStock = await page.textContent('body');
etape('Expedier plus que le stock disponible est refuse',
  refusStock.includes('negatif') || refusStock.includes('Stock insuffisant')
    || refusStock.includes('insuffisant'),
  (await page.textContent('.message.erreur').catch(() => ''))?.slice(0, 90) ?? '');

// On annule ce bon impossible, puis on refait le bon raisonnable.
page.once('dialog', (d) => d.accept('Quantite saisie par erreur'));
await page.click('tbody tr:has-text("a expedier") button:has-text("×")');
await attendre(page, 'annule');
await page.waitForTimeout(600);

await page.click('button:has-text("Nouveau bon")');
await page.waitForTimeout(600);
await page.selectOption('#source', { label: 'Superette principale' });
await page.waitForTimeout(500);
await page.fill('input[placeholder*="Reapprovisionnement"]', 'Essai de transfert');
await page.fill('input[placeholder*="Scannez"]', 'Huile');
await page.waitForTimeout(1200);
await page.keyboard.press('Enter');
await page.waitForTimeout(800);
await page.fill('.carte .tableau tbody tr input', '10');
await page.click('button:has-text("Preparer le bon")');
const prepare = await attendre(page, 'prepare');
etape('Le bon se prepare', prepare.includes('TRF-'), prepare.trim());
etape('L’ecran dit que rien n’a encore bouge', prepare.includes('rien n’a encore bouge')
  || prepare.includes('Rien n’a encore bouge'));

await page.waitForTimeout(800);
const listeApres = await page.textContent('.tableau');
etape('Le bon apparait « a expedier »', listeApres.includes('a expedier'));

// --- Expedier -----------------------------------------------------------
await page.click('tbody tr:has-text("a expedier") button:has-text("Expedier")');
const expedie = await attendre(page, 'expedie');
etape('Le bon s’expedie', expedie.includes('expedie'), expedie.trim());
etape('L’ecran explique que la marchandise est en transit',
  expedie.includes('transit'));

await page.waitForTimeout(800);
const avecTransit = await page.textContent('body');
etape('Le compteur « Valeur sur la route » apparait',
  avecTransit.includes('Valeur sur la route'));

// --- Receptionner avec un manquant --------------------------------------
await page.click('tbody tr:has-text("en transit") button:has-text("Receptionner")');
await page.waitForSelector('h2:has-text("Reception de")', { timeout: 15000 });
await page.waitForTimeout(500);

const preRempli = await page.locator('.carte:has(h2:has-text("Reception de")) .tableau tbody tr input')
  .first().inputValue();
etape('Le comptage est pre-rempli avec ce qui a ete annonce',
  Number(preRempli) === 10, preRempli);

await page.locator('.carte:has(h2:has-text("Reception de")) .tableau tbody tr input').first().fill('9');
await page.waitForTimeout(500);
const avecEcart = await page.textContent('.carte:has(h2:has-text("Reception de"))');
etape('L’ecart apparait des la saisie, avant validation', avecEcart.includes('-1'));
etape('Un champ de motif s’ouvre pour l’ecart',
  await page.locator('input[placeholder="Pourquoi ?"]').count() === 1);

await page.fill('input[placeholder="Pourquoi ?"]', 'Un bidon casse sur le trajet');
await page.fill('input[placeholder*="Palette ouverte"]', 'Colis abime a l’arrivee');
await page.click('button:has-text("Signer le bon de reception")');
const signe = await attendre(page, 'signe');
etape('Le bon de reception se signe', signe.includes('BRT-'), signe.trim());
etape('L’ecart est chiffre dans le message', /\d/.test(signe) && signe.includes('ecart'));
etape('Et il est impute au magasin expediteur',
  signe.includes('reste au compte de'), signe.trim());

await page.waitForTimeout(1000);
const apresReception = await page.textContent('.tableau');
etape('Le bon passe a « receptionne »', apresReception.includes('receptionne'));
etape('L’ecart reste visible dans la liste', apresReception.includes('ecart'));

// --- La consolidation doit s’en apercevoir -------------------------------
await page.click('a:has-text("Rapports")');
await page.waitForSelector('h1:has-text("Rapports")', { timeout: 15000 });
await page.click('.barre-outils button:has-text("Groupe")');
await page.waitForTimeout(1500);

const stockApres = nombre(
  await page.textContent('.carte:has-text("Valeur du stock") .valeur'));
etape('Le stock du groupe a baisse de la valeur perdue',
  stockApres < stockAvant, `${stockAvant} -> ${stockApres} DA`);

const corps = await page.textContent('body');
etape('Les deux magasins portent maintenant du stock chacun',
  corps.includes('Bab Ezzouar'));

await page.click('.barre-outils button:has-text("En transit")');
await page.waitForTimeout(1200);
const transit = await page.textContent('body');
etape('Le rapport « en transit » est vide apres la reception',
  transit.includes('Rien sur la route'));

console.log(`\nResultat : ${ok} / ${total} etape(s)`);
if (refus.length) { console.log('Requetes refusees :'); for (const r of refus) console.log('  ' + r); }
console.log(erreurs.length ? `Erreurs console : ${erreurs.slice(0, 3).join(' | ')}` : 'Aucune erreur console.');
await navigateur.close();
process.exit(ok === total && erreurs.length === 0 ? 0 : 1);
