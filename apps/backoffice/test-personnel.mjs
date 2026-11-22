/**
 * Gestion du personnel, verifiee dans un vrai navigateur (M13).
 *
 * Le scenario qui compte : etablir une paie, puis enregistrer un
 * depart et constater que les acces tombent.
 *
 *   node apps/backoffice/test-personnel.mjs
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
async function attendre(page, f, delai = 20000) {
  await page.waitForFunction((x) => [...document.querySelectorAll('.message')]
    .some((m) => (m.textContent ?? '').includes(x)), f, { timeout: delai });
  return page.evaluate((x) => [...document.querySelectorAll('.message')]
    .map((m) => m.textContent ?? '').find((t) => t.includes(x)) ?? '', f);
}

const dossier = mkdtempSync(join(tmpdir(), 'gestglobale-personnel-'));
const navigateur = await chromium.launch({ args: ['--no-sandbox'] });
const contexte = await navigateur.newContext({
  viewport: { width: 1600, height: 950 }, acceptDownloads: true,
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

await page.click('a:has-text("Personnel")');
await page.waitForSelector('h1:has-text("Personnel")', { timeout: 15000 });
await page.waitForTimeout(1500);

// --- Alerte de fin de contrat -------------------------------------------
const corps = await page.textContent('body');
etape('Les contrats a terme sont signales des l’ouverture',
  corps.includes('arrivent a terme') || corps.includes('arrive a terme'));
etape('L’alerte nomme l’employe et le delai',
  /dans \d+ jour/.test(corps), corps.match(/[A-Z][a-z]+ [A-Z][a-z]+ — [^(]+/)?.[0]?.trim() ?? '');

etape('Les quatre dossiers sont listes',
  ['E0001', 'E0002', 'E0003', 'E0004'].every((m) => corps.includes(m)));
// Les montants s'affichent avec une espace fine insecable : on compare
// donc sur les chiffres, pas sur la mise en forme.
const sansEspaces = corps.replace(/[\u202f\u00a0\s]/g, '');
etape('Le gerant voit les salaires',
  corps.includes('Salaire de base') && sansEspaces.includes('40000,00DA'));
etape('Le compte de caisse rattache est montre',
  corps.includes('caissier1 (code 3)'));

// --- Attestation ---------------------------------------------------------
const attente = page.waitForEvent('download', { timeout: 30000 });
await page.click('tbody tr:has-text("E0001") button:has-text("Attestation")');
const fichier = await attente;
const chemin = join(dossier, fichier.suggestedFilename());
await fichier.saveAs(chemin);
const pdf = readFileSync(chemin);
etape('L’attestation de travail se telecharge',
  pdf.subarray(0, 5).toString() === '%PDF-', `${pdf.length} octets`);

// --- Conges ---------------------------------------------------------------
await page.click('.barre-outils button:has-text("Conges")');
await page.waitForTimeout(1200);
etape('L’onglet des conges s’affiche',
  (await page.textContent('body')).includes('Solde')
    || (await page.textContent('body')).includes('Aucune demande'));

// --- Paie -----------------------------------------------------------------
await page.click('.barre-outils button:has-text("Paie")');
await page.waitForTimeout(1500);
const paie = await page.textContent('body');
etape('L’onglet de paie s’affiche', paie.includes('Masse salariale brute'));
etape('Il rappelle que les taux doivent etre valides par le comptable',
  paie.includes('valides par votre comptable'));

await page.click('tbody tr:has-text("E0001") button:has-text("Etablir le bulletin")');
const etabli = await attendre(page, 'etabli');
etape('Un bulletin s’etablit depuis l’ecran', etabli.includes('PAIE-'), etabli.trim());
etape('Le net a payer est annonce', /\d/.test(etabli) && etabli.includes('net a payer'));

await page.waitForTimeout(1000);
const apresPaie = await page.textContent('body');
etape('Le bulletin apparait dans le livre de paie',
  apresPaie.includes('PAIE-') && apresPaie.includes('a verser'));

const attenteLivre = page.waitForEvent('download', { timeout: 30000 });
await page.click('.entete-page button:has-text("Livre de paie")');
const livre = await attenteLivre;
const cheminLivre = join(dossier, livre.suggestedFilename());
await livre.saveAs(cheminLivre);
etape('Le livre de paie s’exporte en Excel',
  readFileSync(cheminLivre).subarray(0, 2).toString() === 'PK',
  livre.suggestedFilename());

// --- Performance ----------------------------------------------------------
await page.click('.barre-outils button:has-text("Performance")');
await page.waitForTimeout(1500);
const perf = await page.textContent('body');
etape('La performance par employe s’affiche',
  perf.includes('CA encaisse') && perf.includes('Ecart caisse'));
etape('Elle rappelle qu’un ecart n’est pas une faute',
  perf.includes('jamais une faute'));

// --- Depart : le point qui compte ------------------------------------------
await page.click('.barre-outils button:has-text("Dossiers")');
await page.waitForTimeout(1200);

let avertissement = '';
page.once('dialog', (d) => { avertissement = d.message(); d.accept('Demission'); });
await page.click('tbody tr:has-text("E0001") button:has-text("Depart")');
const depart = await attendre(page, 'sorti');
etape('L’ecran previent que le compte sera desactive',
  avertissement.includes('desactive') && avertissement.includes('code PIN'),
  avertissement.replace(/\n+/g, ' ').slice(0, 90));
etape('Le depart est enregistre et le compte coupe',
  depart.includes('acces sont coupes'), depart.trim());

await page.waitForTimeout(1000);
const apresDepart = await page.textContent('tbody tr:has-text("E0001")');
etape('Le dossier porte la mention « sorti »', apresDepart.includes('sorti'));
etape('Et c’est un certificat, non plus une attestation, qu’on lui delivre',
  apresDepart.includes('Certificat'));

console.log(`\nResultat : ${ok} / ${total} etape(s)`);
if (refus.length) { console.log('Requetes refusees :'); for (const r of refus) console.log('  ' + r); }
console.log(erreurs.length ? `Erreurs console : ${erreurs.slice(0, 3).join(' | ')}` : 'Aucune erreur console.');
await navigateur.close();
process.exit(ok === total && erreurs.length === 0 ? 0 : 1);
