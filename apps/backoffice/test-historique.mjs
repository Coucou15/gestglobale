/**
 * Consultation de l'historique repris, verifiee dans un vrai navigateur.
 *
 * Prerequis : une base ou l'export du client a ete importe, l'API sur le
 * port 3000 et le back-office sur le 5173.
 *
 *   node apps/backoffice/test-historique.mjs
 */
import { createRequire } from 'node:module';
const requis = createRequire(import.meta.url);
const { chromium } = requis('playwright');

const erreurs = [];
const refus = [];
let ok = 0, total = 0;
const etape = (nom, reussi, detail = '') => {
  total++; if (reussi) ok++;
  console.log(`  ${reussi ? 'OK   ' : 'ECHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

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

await page.click('a:has-text("Historique repris")');
await page.waitForSelector('h1:has-text("Historique")', { timeout: 15000 });
await page.waitForTimeout(2000);

const corps = await page.textContent('body');
etape('La page liste l’historique repris', /ligne\(s\)/.test(corps));
const cartes = await page.locator('.cartes .carte .valeur').allTextContents();
etape('Les cinq origines sont comptees', cartes.length === 5, cartes.join(' / '));
const lignes = await page.locator('.tableau table tbody tr').count();
etape('Des lignes sont affichees', lignes > 10, `${lignes} ligne(s)`);

// Filtre sur les clotures de caisse : le defaut du cahier des charges.
await page.locator('.barre-outils select').selectOption('CLOTURE_CAISSE');
await page.waitForTimeout(1500);
const texteClotures = await page.textContent('.tableau');
etape('Les clotures de l’ancien logiciel sont retrouvees',
  texteClotures.includes('comptage non saisi'));

// Detail : toutes les colonnes d'origine.
await page.locator('.tableau button:has-text("Voir")').first().click();
await page.waitForSelector('.modale', { timeout: 10000 });
const modale = await page.textContent('.modale');
etape('Le detail montre les colonnes d’origine',
  modale.includes('recette comptable es') || modale.includes('recette physique es'),
  modale.slice(0, 60).replace(/\s+/g, ' '));
await page.click('.modale button:has-text("Fermer")');

// Recherche d'un document precis.
await page.locator('.barre-outils select').selectOption('');
await page.fill('input[placeholder*="Numero de document"]', '20000257');
await page.waitForTimeout(1800);
const trouve = await page.textContent('.tableau');
etape('Un document ancien se retrouve par son numero', trouve.includes('20000257'));

console.log(`\nResultat : ${ok} / ${total} etape(s)`);
if (refus.length) { console.log('Requetes refusees :'); for (const r of refus) console.log('  ' + r); }
console.log(erreurs.length ? `Erreurs console : ${erreurs.slice(0, 5).join(' | ')}` : 'Aucune erreur console.');
await navigateur.close();
process.exit(ok === total && erreurs.length === 0 ? 0 : 1);
