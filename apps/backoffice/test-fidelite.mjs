/**
 * Fidelite, cartes cadeaux et bons d'achat, verifies dans un vrai
 * navigateur.
 *
 * Prerequis : l'API sur le port 3000 avec le jeu de demonstration, et le
 * back-office sur le 5173.
 *
 *   node apps/backoffice/test-fidelite.mjs
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

const navigateur = await chromium.launch({ args: ['--no-sandbox'] });
const page = await navigateur.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
page.on('pageerror', (e) => erreurs.push(String(e)));
page.on('response', (r) => { if (r.status() >= 400) refus.push(`${r.status()} ${r.url()}`); });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.fill('#login', 'gerant');
await page.fill('#mdp', 'GestGlobale2026!');
await page.click('button.principal');
await page.waitForSelector('.carte .valeur', { timeout: 20000 });

await page.click('a:has-text("Fidelite et bons")');
await page.waitForSelector('h1:has-text("Fidelite")', { timeout: 15000 });
await page.waitForTimeout(1500);

const corps = await page.textContent('.tableau');
etape('Les bons du jeu d’essai sont listes',
  corps.includes('CAD-') && corps.includes('BON-'), corps.match(/CAD-\d{4}-\d{6}/)?.[0] ?? '');
etape('Leur etat est affiche', corps.includes('valable'));
etape('Le bareme de fidelite est rappele',
  (await page.textContent('body')).includes('point par'));

const engagement = await page.textContent('.barre-outils:has-text("en circulation")');
etape('L’engagement total envers les clients est chiffre',
  /\d/.test(engagement) && engagement.includes('en circulation'), engagement.trim());

// --- Emission ----------------------------------------------------------
await page.click('button:has-text("Emettre des bons")');
await page.waitForTimeout(400);
await page.fill('input[placeholder="Montant en DA"]', '2500');
await page.fill('input[placeholder="Nombre de bons"]', '3');
await page.click('button:has-text("Emettre")');
const emis = await attendre(page, 'emis');
etape('Trois cartes cadeaux s’emettent d’un coup', emis.includes('3 bons emis'), emis.trim());

const codes = await page.textContent('.carte:has-text("Codes a remettre")');
const nouveaux = [...codes.matchAll(/CAD-\d{4}-\d{6}/g)].map((m) => m[0]);
etape('Les codes a remettre aux clients sont affiches', nouveaux.length === 3,
  nouveaux.join(', '));

await page.waitForTimeout(800);
etape('Le nouveau bon figure dans la liste',
  (await page.textContent('.tableau')).includes(nouveaux[0]));

// --- Annulation --------------------------------------------------------
page.once('dialog', (d) => d.accept('Carte perdue par le client'));
await page.locator(`tr:has-text("${nouveaux[0]}") button:has-text("Annuler")`).click();
const annule = await attendre(page, 'annule');
etape('Une carte perdue s’annule avec un motif',
  annule.includes(nouveaux[0]), annule.trim());
etape('L’avertissement sur les caisses hors ligne est donne',
  annule.includes('hors ligne'));

await page.waitForTimeout(600);
await page.locator('label:has-text("Valables seulement") input').uncheck();
await page.waitForTimeout(1200);
const ligneAnnulee = await page.textContent(`tr:has-text("${nouveaux[0]}")`);
etape('La carte annulee reste visible avec son motif',
  ligneAnnulee.includes('annule') && ligneAnnulee.includes('Carte perdue'));

// --- Conversion de points ---------------------------------------------
await page.click('button:has-text("Convertir des points")');
await page.waitForTimeout(400);
await page.fill('#client', 'Client fidelite');
await page.waitForSelector('.carte tr:has-text("Client fidelite 0002")', { timeout: 15000 });
await page.click('.carte tr:has-text("Client fidelite 0002")');
await page.waitForTimeout(1200);

const soldePoints = await page.textContent('.carte:has-text("Convertir des points")');
etape('Les points du client et leur valeur sont affiches',
  /\d+\s*points?/.test(soldePoints), soldePoints.match(/\d+ points?[^.]*/)?.[0]?.trim() ?? '');

await page.fill('input[placeholder="Points a convertir"]', '60');
await page.click('.carte button:has-text("Convertir")');
const converti = await attendre(page, 'convertis en bon');
etape('Les points se convertissent en bon d’achat',
  converti.includes('60 points'), converti.trim());
etape('Le reste de points est annonce au gerant', /Reste \d+ point/.test(converti));

await page.waitForTimeout(800);
const bonPoints = (await page.textContent('.carte:has-text("Codes a remettre")'))
  .match(/BON-\d{4}-\d{6}/)?.[0];
etape('Le bon issu des points porte un code remettable', Boolean(bonPoints), bonPoints ?? '');

// Trop de points : le serveur doit refuser et l'ecran l'expliquer.
await page.click('button:has-text("Convertir des points")');
await page.waitForTimeout(400);
await page.fill('#client', 'Client fidelite');
await page.waitForSelector('.carte tr:has-text("Client fidelite 0002")', { timeout: 15000 });
await page.click('.carte tr:has-text("Client fidelite 0002")');
await page.waitForTimeout(1200);
const restants = Number(
  (await page.textContent('.carte:has-text("Convertir des points")')).match(/(\d+)\s*points?/)?.[1] ?? 0,
);
etape('Le solde de points a bien diminue', restants > 0 && restants < 200, String(restants));
etape('Le bouton refuse d’emblee plus de points que le client n’en a',
  await page.locator('.carte button:has-text("Convertir")').isDisabled() === false);
await page.fill('input[placeholder="Points a convertir"]', String(restants + 500));
etape('Convertir plus de points que disponible reste impossible',
  await page.locator('.carte button:has-text("Convertir")').isDisabled());

// --- Rapport des depassements -----------------------------------------
etape('Le rapport des bons presentes au-dela du solde est present',
  (await page.textContent('body')).includes('au-dela de leur solde'));

console.log(`\nResultat : ${ok} / ${total} etape(s)`);
if (refus.length) {
  console.log('Requetes refusees :');
  for (const r of refus) console.log('  ' + r);
}
console.log(erreurs.length ? `Erreurs console : ${erreurs.slice(0, 3).join(' | ')}` : 'Aucune erreur console.');
await navigateur.close();
process.exit(ok === total && erreurs.length === 0 ? 0 : 1);
