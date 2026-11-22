/**
 * Journaux comptables et etats de declaration, verifies dans un vrai
 * navigateur (M12).
 *
 * Verifie aussi que le comptable, avec son propre compte, voit ce qui
 * lui revient et rien de plus.
 *
 *   node apps/backoffice/test-comptabilite.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const erreurs = []; const refus = [];
let ok = 0, total = 0;
const etape = (n, r, d = '') => { total++; if (r) ok++; console.log(`  ${r ? 'OK   ' : 'ECHEC'} ${n}${d ? ` — ${d}` : ''}`); };
const nombre = (texte) =>
  Number((texte ?? '').replace(/[^0-9,]/g, '').replace(/\s/g, '').replace(',', '.'));

const dossier = mkdtempSync(join(tmpdir(), 'gestglobale-compta-'));
const navigateur = await chromium.launch({ args: ['--no-sandbox'] });
const contexte = await navigateur.newContext({
  viewport: { width: 1600, height: 950 }, acceptDownloads: true,
});
const page = await contexte.newPage();
page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
page.on('pageerror', (e) => erreurs.push(String(e)));
page.on('response', (r) => { if (r.status() >= 400) refus.push(`${r.status()} ${r.url()}`); });

// Le comptable se connecte avec son propre compte.
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.fill('#login', 'comptable');
await page.fill('#mdp', 'GestGlobale2026!');
await page.click('button.principal');
await page.waitForSelector('.carte .valeur', { timeout: 20000 });

const menu = await page.textContent('.menu');
etape('Le comptable a bien l’entree « Comptabilite »', menu.includes('Comptabilite'));
// « Tous les rapports » lui ouvre les ecrans de consultation, caisses
// comprises — il en a besoin pour rapprocher les especes. Le journal
// d'audit, lui, reste au gerant seul.
etape('« Tous les rapports » lui ouvre bien les ecrans de consultation',
  menu.includes('Rapports') && menu.includes('Caisses'));
etape('Mais le journal d’audit reste hors de sa portee',
  !menu.includes('audit'), menu.replace(/\s+/g, ' ').trim());

// Il consulte les stocks sans pouvoir les deplacer : la section 6 lui
// donne la lecture, pas le geste.
await page.click('a:has-text("Transferts")');
await page.waitForTimeout(1200);
etape('Il consulte les transferts sans pouvoir en creer',
  (await page.locator('button:has-text("Nouveau bon")').count()) === 0);

await page.click('a:has-text("Comptabilite")');
await page.waitForSelector('h1:has-text("Comptabilite")', { timeout: 15000 });
await page.waitForTimeout(1200);

// La periode par defaut est le mois precedent : un mois clos.
const debutDefaut = await page.locator('#debut').inputValue();
const moisDernier = new Date();
moisDernier.setMonth(moisDernier.getMonth() - 1, 1);
etape('La periode s’ouvre sur le mois precedent, un mois clos',
  debutDefaut.startsWith(moisDernier.toISOString().slice(0, 7)), debutDefaut);

// On se place sur le mois en cours, ou sont les ecritures du jeu d'essai.
const debutMois = new Date();
debutMois.setDate(1);
await page.fill('#debut', debutMois.toISOString().slice(0, 10));
await page.fill('#fin', new Date().toISOString().slice(0, 10));
await page.waitForTimeout(1500);

const ventes = await page.textContent('body');
etape('Le journal des ventes s’affiche',
  ventes.includes('Pieces') && ventes.includes('Total TTC'));
etape('Chaque ligne porte sa piece et son reglement',
  ventes.includes('SV-03-') && ventes.includes('Especes'));
etape('La ventilation par taux a sa colonne', ventes.includes('Base 0 %'));

const totalEcran = nombre(await page.textContent('.carte:has-text("Total TTC") .valeur'));
etape('Le total TTC est chiffre', totalEcran > 0, `${totalEcran} DA`);

// --- Export CSV, puis relecture ----------------------------------------
const telechargerFichier = async (bouton) => {
  const attente = page.waitForEvent('download', { timeout: 30000 });
  await page.click(`.entete-page button:has-text("${bouton}")`);
  const fichier = await attente;
  const chemin = join(dossier, fichier.suggestedFilename());
  await fichier.saveAs(chemin);
  return chemin;
};

const csv = await telechargerFichier('CSV');
const contenu = readFileSync(csv, 'utf8');
etape('L’export CSV se telecharge', contenu.length > 100, csv.split('/').pop());
etape('Il porte la marque d’encodage qu’attend Excel sous Windows',
  contenu.charCodeAt(0) === 0xfeff);
etape('Ses colonnes sont separees par des points-virgules',
  contenu.includes('Date;Mag.;Piece'));

const ligneTotal = contenu.split('\r\n').find((l) => l.includes(';Total;'));
const totalCsv = Number(
  ligneTotal.split(';').filter((v) => /^-?\d+,\d{2}$/.test(v)).pop().replace(',', '.'),
);
etape('Le total du fichier egale celui de l’ecran',
  Math.abs(totalCsv - totalEcran) < 0.01, `${totalCsv} contre ${totalEcran}`);

// Le separateur se regle : le format du comptable n'est pas connu.
await page.selectOption('#separateur', 'tabulation');
await page.waitForTimeout(400);
const csvTab = readFileSync(await telechargerFichier('CSV'), 'utf8');
etape('Le separateur se change depuis l’ecran',
  csvTab.includes('Date\tMag.\tPiece'));
await page.selectOption('#separateur', 'point-virgule');

const xlsx = readFileSync(await telechargerFichier('Excel'));
etape('L’export Excel se telecharge', xlsx.subarray(0, 2).toString() === 'PK',
  `${xlsx.length} octets`);
const pdf = readFileSync(await telechargerFichier('PDF'));
etape('L’export PDF se telecharge', pdf.subarray(0, 5).toString() === '%PDF-',
  `${pdf.length} octets`);

// --- Les autres journaux ------------------------------------------------
for (const [onglet, attendu] of [
  ['Achats', 'TVA deductible'],
  ['Tresorerie', 'Par categorie'],
  ['Declarations', 'Ventes par taux de TVA'],
]) {
  await page.click(`.barre-outils button:has-text("${onglet}")`);
  await page.waitForTimeout(1300);
  const texte = await page.textContent('body');
  etape(`Le journal « ${onglet} » s’affiche`, texte.includes(attendu));
}

// L'etat de declaration doit dire ce qu'il n'est pas.
const declaration = await page.textContent('body');
etape('L’etat de declaration ne se fait pas passer pour une declaration',
  declaration.includes('n’est pas une declaration remplie'));
etape('Il signale le regime a TVA nulle a trancher',
  declaration.includes('toutes les ventes sont a TVA 0'));
etape('Il chiffre la TVA collectee et la TVA deductible',
  declaration.includes('TVA collectee') && declaration.includes('TVA deductible'));

const csvDeclaration = readFileSync(await telechargerFichier('CSV'), 'utf8');
etape('L’etat de declaration s’exporte aussi',
  csvDeclaration.includes('Etat pour les declarations'));
etape('La mise en garde suit le fichier',
  csvDeclaration.includes('pas une declaration remplie'));

console.log(`\nResultat : ${ok} / ${total} etape(s)`);
if (refus.length) { console.log('Requetes refusees :'); for (const r of refus) console.log('  ' + r); }
console.log(erreurs.length ? `Erreurs console : ${erreurs.slice(0, 3).join(' | ')}` : 'Aucune erreur console.');
await navigateur.close();
process.exit(ok === total && erreurs.length === 0 ? 0 : 1);
