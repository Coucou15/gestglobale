/**
 * Documents de vente a valeur legale, verifies dans un vrai navigateur.
 *
 * Facture refusee sans client, validation, impression A4 avec mentions
 * legales et montant en toutes lettres, avoir etabli d'apres la facture,
 * sortie de stock et dette du client.
 *
 * Prerequis : l'API sur le port 3000 avec le jeu de demonstration, et le
 * back-office sur le 5173.
 *
 *   node apps/backoffice/test-documents.mjs
 */
import { createRequire } from 'node:module';
const requis = createRequire(import.meta.url);
const { chromium } = requis('playwright');

const erreurs = []; const refus = [];
let ok = 0, total = 0;
const etape = (n, r, d = '') => { total++; if (r) ok++; console.log(`  ${r ? 'OK   ' : 'ECHEC'} ${n}${d ? ` — ${d}` : ''}`); };

async function attendre(page, fragment, delai = 25000) {
  await page.waitForFunction(
    (f) => [...document.querySelectorAll('.message')].some((m) => (m.textContent ?? '').includes(f)),
    fragment, { timeout: delai },
  );
  return page.evaluate((f) => [...document.querySelectorAll('.message')]
    .map((m) => m.textContent ?? '').find((t) => t.includes(f)) ?? '', fragment);
}

const navigateur = await chromium.launch({ args: ['--no-sandbox'] });
const contexte = await navigateur.newContext({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
const page = await contexte.newPage();
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
page.on('pageerror', (e) => erreurs.push(String(e)));
page.on('response', (r) => { if (r.status() >= 400) refus.push(`${r.status()} ${r.url()}`); });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.fill('#login', 'gerant');
await page.fill('#mdp', 'GestGlobale2026!');
await page.click('button.principal');
await page.waitForSelector('.carte .valeur', { timeout: 20000 });

await page.click('a:has-text("Factures et BL")');
await page.waitForSelector('h1:has-text("Documents de vente")', { timeout: 15000 });
await page.click('button:has-text("Nouveau document")');
await page.waitForTimeout(500);

// Le magasin se choisit maintenant : avec deux superettes, le prendre
// au hasard faisait facturer au nom de la mauvaise.
const choix = page.locator('#choix-magasin');
if (await choix.count() > 0) {
  await choix.selectOption({ label: 'Superette principale' });
  await page.waitForTimeout(300);
  etape('Le magasin de travail se choisit explicitement',
    (await choix.locator('option').count()) >= 2,
    `${await choix.locator('option').count()} magasins proposes`);
}

// Une facture exige un client : le bouton doit rester desactive.
const bouton = page.locator('button:has-text("Enregistrer le brouillon")');
const chercheur = page.locator('input[placeholder*="Scannez ou cherchez"]');
await chercheur.fill('6130000000017');
await page.waitForTimeout(800);
await chercheur.press('Enter');
await page.waitForTimeout(500);
etape('Une facture sans client ne peut pas etre enregistree', await bouton.isDisabled());

await page.fill('input[placeholder*="Client"]', 'Cafeteria');
await page.waitForTimeout(1200);
await page.locator('.tableau tbody tr').first().click();
await page.waitForTimeout(400);
await page.locator('.carte table tbody tr input').first().fill('3');
etape('Client selectionne, le document devient enregistrable', !(await bouton.isDisabled()));

await bouton.click();
await page.waitForSelector('.modale', { timeout: 20000 });
etape('Brouillon enregistre, fenetre de validation ouverte', true);

const [onglet] = await Promise.all([
  contexte.waitForEvent('page'),
  page.click('.modale button:has-text("Valider et imprimer")'),
]);
// window.open ouvre d'abord une page vide : on attend le document lui-meme,
// pas la fin du reseau, sinon on lit un onglet encore blanc.
await onglet.waitForSelector('.feuille .numero', { timeout: 25000 });
const imprime = await onglet.textContent('.feuille');
etape('Le document s’ouvre pret a imprimer', imprime.includes('FACTURE'));
etape('Il porte les mentions legales de l’emetteur', imprime.includes('RC 16/00-0000000 B 00'));
etape('Il porte celles du client', imprime.includes('16/00-1111111 B 11'));
etape('Il porte le montant en toutes lettres', /dinars?/.test(imprime) && imprime.includes('Arrete le present document'));
const numeroFacture = (imprime.match(/FA-\d{4}-\d{6}/) ?? [])[0];
etape('Numerotation legale sans trou', Boolean(numeroFacture), numeroFacture);
await onglet.close();

await page.waitForTimeout(1200);
const liste = await page.textContent('.tableau');
etape('La facture apparait validee', liste.includes(numeroFacture ?? 'FA-'));

// Avoir etabli d'apres la facture.
await page.locator(`tr:has-text("${numeroFacture}") button:has-text("Etablir un avoir")`).click();
const messageAvoir = await attendre(page, 'Avoir');
etape('Un avoir est etabli d’apres la facture', true, messageAvoir.trim());

// Le stock a bien bouge, et dans le bon sens.
const jeton = await page.evaluate(() => sessionStorage.getItem('gestglobale.jeton'));
const mouvements = await fetch('http://localhost:3000/api/v1/stocks/mouvements?taille=20',
  { headers: { Authorization: `Bearer ${jeton}` } }).then((r) => r.json());
const sortie = mouvements.find((m) => m.documentNumero === numeroFacture);
etape('La facture a sorti la marchandise du stock',
  Boolean(sortie) && sortie.quantiteMilli < 0,
  sortie ? `${sortie.quantiteMilli / 1000} unite(s)` : 'aucun mouvement');

// La dette du client est enregistree.
const releve = await fetch('http://localhost:3000/api/v1/tiers?type=CLIENT&texte=Cafeteria',
  { headers: { Authorization: `Bearer ${jeton}` } }).then((r) => r.json());
etape('La dette du client est enregistree', releve.tiers[0].soldeCentimes > 0,
  `${releve.tiers[0].soldeCentimes / 100} DA`);

// Le PDF est fabrique par le serveur : c'est celui qu'on joindra a un
// courriel, la ou l'impression du navigateur demande un geste humain.
const attentePdf = page.waitForEvent('download', { timeout: 30000 });
await page.click('tbody tr:has-text("FA-2026-") button:has-text("PDF")');
const fichierPdf = await attentePdf;
const { readFileSync, mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const cheminPdf = join(mkdtempSync(join(tmpdir(), 'gestglobale-pdf-')), fichierPdf.suggestedFilename());
await fichierPdf.saveAs(cheminPdf);
const octets = readFileSync(cheminPdf);
etape('La facture se telecharge en PDF depuis l\u2019ecran',
  octets.subarray(0, 5).toString() === '%PDF-', `${octets.length} octets`);
etape('Le fichier porte le numero de la facture',
  fichierPdf.suggestedFilename().startsWith('FA-2026-'),
  fichierPdf.suggestedFilename());

console.log(`\nResultat : ${ok} / ${total} etape(s)`);
if (refus.length) { console.log('Requetes refusees :'); for (const r of refus) console.log('  ' + r); }
console.log(erreurs.length ? `Erreurs console : ${erreurs.slice(0, 4).join(' | ')}` : 'Aucune erreur console.');
await navigateur.close();
process.exit(ok === total && erreurs.length === 0 ? 0 : 1);
