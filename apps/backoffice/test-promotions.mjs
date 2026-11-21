/**
 * Gestion des promotions, verifiee dans un vrai navigateur.
 *
 * Prerequis : l'API sur le port 3000 avec le jeu de demonstration, et le
 * back-office sur le 5173.
 *
 *   node apps/backoffice/test-promotions.mjs
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

await page.click('a:has-text("Promotions")');
await page.waitForSelector('h1:has-text("Promotions")', { timeout: 15000 });
await page.waitForTimeout(1500);

const corps = await page.textContent('.tableau');
etape('Les quatre promotions du jeu d’essai sont listees',
  ['Prix barre', 'X achetes', 'Remise sur une famille', 'Happy hour']
    .every((t) => corps.includes(t)));
etape('Leur etat est affiche', corps.includes('en cours'));

// Creation d'une promotion incomplete : le serveur doit l'expliquer.
await page.click('button:has-text("Nouvelle promotion")');
await page.waitForTimeout(400);
await page.locator('.carte select').first().selectOption('REMISE_FAMILLE');
await page.fill('input[placeholder*="Code"]', 'TEST-PROMO');
await page.fill('input[placeholder*="Libelle"]', 'Essai de promotion');
await page.fill('input[placeholder="Remise en %"]', '15');

// Une remise par famille en exige une : le bouton reste ferme tant
// qu'aucune n'est choisie.
etape('Une remise par famille sans famille reste impossible',
  await page.locator('button:has-text("Creer la promotion")').isDisabled());
await page.locator('.carte select').nth(1).selectOption({ index: 1 });
await page.click('button:has-text("Creer la promotion")');
const cree = await attendre(page, 'Promotion creee');
etape('Une promotion se cree depuis le back-office', true, cree.trim());

await page.waitForTimeout(1200);
etape('Elle apparait dans la liste',
  (await page.textContent('.tableau')).includes('TEST-PROMO'));

// Suspension.
await page.locator('tr:has-text("TEST-PROMO") button:has-text("Suspendre")').click();
await attendre(page, 'suspendue');
etape('Elle se suspend', (await page.textContent('tr:has-text("TEST-PROMO")')).includes('suspendue'));

// Suppression d'une promotion jamais utilisee.
await page.locator('tr:has-text("TEST-PROMO") button:has-text("×")').click();
await attendre(page, 'supprimee');
etape('Une promotion jamais utilisee se supprime',
  !(await page.textContent('.tableau')).includes('TEST-PROMO'));

console.log(`\nResultat : ${ok} / ${total} etape(s)`);
if (refus.length) { console.log('Requetes refusees :'); for (const r of refus) console.log('  ' + r); }
console.log(erreurs.length ? `Erreurs console : ${erreurs.slice(0, 3).join(' | ')}` : 'Aucune erreur console.');
await navigateur.close();
process.exit(ok === total && erreurs.length === 0 ? 0 : 1);
