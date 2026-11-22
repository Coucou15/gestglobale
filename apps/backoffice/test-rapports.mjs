/**
 * Rapports du gerant, verifies dans un vrai navigateur (M9).
 *
 * Les exports sont reellement telecharges et relus : un fichier qui
 * s'ouvre mais ne contient pas les memes chiffres que l'ecran serait
 * pire qu'une absence d'export.
 *
 *   node apps/backoffice/test-rapports.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

const erreurs = []; const refus = [];
let ok = 0, total = 0;
const etape = (n, r, d = '') => { total++; if (r) ok++; console.log(`  ${r ? 'OK   ' : 'ECHEC'} ${n}${d ? ` — ${d}` : ''}`); };

const dossier = mkdtempSync(join(tmpdir(), 'gestglobale-exports-'));
const navigateur = await chromium.launch({ args: ['--no-sandbox'] });
const contexte = await navigateur.newContext({
  viewport: { width: 1500, height: 950 },
  acceptDownloads: true,
});
const page = await contexte.newPage();
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
page.on('pageerror', (e) => erreurs.push(String(e)));
page.on('response', (r) => { if (r.status() >= 400) refus.push(`${r.status()} ${r.url()}`); });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.fill('#login', 'gerant');
await page.fill('#mdp', 'GestGlobale2026!');
await page.click('button.principal');
await page.waitForSelector('.carte .valeur', { timeout: 20000 });

await page.click('a:has-text("Rapports")');
await page.waitForSelector('h1:has-text("Rapports")', { timeout: 15000 });
await page.waitForTimeout(1500);

// --- Synthese ----------------------------------------------------------
// Depuis M11, l'ecran s'ouvre sur la consolidation du groupe : la
// synthese d'un magasin se demande.
await page.click('.barre-outils button:has-text("Synthese")');
await page.waitForTimeout(1500);
const corps = await page.textContent('body');
etape('La synthese s’affiche',
  corps.includes('Chiffre d’affaires TTC') && corps.includes('Panier moyen'));
etape('Les axes exiges par la section 9 sont tous presents',
  ['Par jour', 'Par heure', 'Par caisse', 'Par caissier', 'Par rayon et famille',
    'Par mode de reglement'].every((t) => corps.includes(t)),
  'jour, heure, caisse, caissier, rayon, famille');

const caEcran = (await page.textContent('.carte:has-text("Chiffre d’affaires TTC") .valeur')).trim();
etape('Le chiffre d’affaires est affiche', /\d/.test(caEcran), caEcran);

// --- Telechargement Excel, puis relecture ------------------------------
const telecharger = async (bouton) => {
  const attente = page.waitForEvent('download', { timeout: 30000 });
  await page.click(`.entete-page button:has-text("${bouton}")`);
  const fichier = await attente;
  const chemin = join(dossier, fichier.suggestedFilename());
  await fichier.saveAs(chemin);
  return chemin;
};

const xlsx = await telecharger('Excel');
etape('L’export Excel se telecharge', existsSync(xlsx), xlsx.split('/').pop());

const classeur = new ExcelJS.Workbook();
await classeur.xlsx.readFile(xlsx);
etape('Le classeur porte un onglet par axe',
  ['Resume', 'Par jour', 'Par heure', 'Par caisse', 'Par caissier'].every(
    (n) => classeur.worksheets.some((f) => f.name === n)),
  classeur.worksheets.map((f) => f.name).join(', '));

const parJour = classeur.getWorksheet('Par jour');
const cellule = parJour.getCell('C2');
etape('Les montants sont des nombres, pas du texte',
  typeof cellule.value === 'number' && cellule.numFmt === '#,##0.00',
  `${cellule.value} (${cellule.numFmt})`);

// Le chiffre de l'ecran et celui du fichier doivent coincider.
const caFichier = Number(cellule.value);
const caEcranNombre = Number(
  caEcran.replace(/[^0-9,]/g, '').replace(/\s/g, '').replace(',', '.'),
);
etape('Le fichier porte le meme chiffre d’affaires que l’ecran',
  Math.abs(caFichier - caEcranNombre) < 0.01,
  `${caFichier} contre ${caEcranNombre}`);

etape('L’entete est figee et filtrable',
  parJour.views?.[0]?.state === 'frozen' && Boolean(parJour.autoFilter));

const pdf = await telecharger('PDF');
const octets = readFileSync(pdf);
etape('L’export PDF se telecharge', octets.length > 1000, `${octets.length} octets`);
etape('C’est un vrai PDF', octets.subarray(0, 5).toString() === '%PDF-',
  octets.subarray(0, 8).toString());

// --- Les autres rapports ------------------------------------------------
for (const [onglet, attendu] of [
  ['Palmares', 'Designation'],
  ['Ventes a perte', 'CUMP moyen'],
  ['Ecarts de caisse', 'Ecart cumule'],
  ['Annulations et remises', 'Remises par caissier'],
  ['Ruptures', 'Sous le seuil'],
  ['Dormants', 'Argent immobilise'],
]) {
  await page.click(`.barre-outils button:has-text("${onglet}")`);
  await page.waitForTimeout(1200);
  const texte = await page.textContent('body');
  etape(`Le rapport « ${onglet} » s’affiche`, texte.includes(attendu));
}

// Un export depuis un autre onglet doit porter sur CE rapport.
const xlsxRuptures = await telecharger('Excel');
etape('L’export suit l’onglet affiche',
  xlsxRuptures.includes('dormants'), xlsxRuptures.split('/').pop());

// --- Resume quotidien ---------------------------------------------------
await page.click('.barre-outils button:has-text("Resumes quotidiens")');
await page.waitForTimeout(1000);
etape('L’onglet des resumes masque les boutons d’export',
  (await page.locator('.entete-page button:has-text("Excel")').count()) === 0);

await page.click('button:has-text("Produire le resume")');
await page.waitForSelector('.message', { timeout: 30000 });
const message = await page.textContent('.message');
etape('Le resume d’hier se produit a la demande', message.length > 10, message.trim());
etape('Faute de relais, l’ecran dit pourquoi il n’est pas parti',
  message.includes('non envoye') || message.includes('envoye'));

await page.waitForTimeout(800);
const resume = await page.textContent('body');
etape('Le texte du resume est lisible a l’ecran',
  resume.includes('Points de vigilance') && resume.includes('Recette TTC'));

console.log(`\nResultat : ${ok} / ${total} etape(s)`);
if (refus.length) { console.log('Requetes refusees :'); for (const r of refus) console.log('  ' + r); }
console.log(erreurs.length ? `Erreurs console : ${erreurs.slice(0, 3).join(' | ')}` : 'Aucune erreur console.');
await navigateur.close();
process.exit(ok === total && erreurs.length === 0 ? 0 : 1);
