/**
 * Parcours de saisie du back-office, verifie dans un vrai navigateur.
 *
 * Reception fournisseur, inventaire, depense et transfert, puis controle
 * du cloisonnement des droits en se reconnectant en magasinier.
 *
 * Prerequis : l'API sur le port 3000 avec le jeu de demonstration, et le
 * back-office servi sur le port 5173 (pnpm dev:bo).
 *
 *   node apps/backoffice/test-navigateur.mjs
 */
import { createRequire } from 'node:module';
const requis = createRequire(import.meta.url);
const { chromium } = requis('playwright');

const erreurs = [];
const refusees = [];
const etapes = [];

let phase = 'demarrage';
function etape(nom, ok, detail = '') {
  phase = nom;
  etapes.push({ nom, ok, detail });
  console.log(`  ${ok ? 'OK   ' : 'ECHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Choisit l'option dont le libelle contient ce fragment. */
async function choisirOption(selecteur, fragment) {
  const valeur = await selecteur.evaluate((element, f) => {
    const option = Array.from(element.options).find(
      (o) => (o.textContent ?? '').includes(f),
    );
    return option ? option.value : null;
  }, fragment);
  if (!valeur) throw new Error(`Aucune option contenant « ${fragment} »`);
  await selecteur.selectOption(valeur);
}

/** Attend qu'un message contenant ce texte apparaisse, et le rend. */
async function attendreMessage(page, fragment, delai = 25000) {
  await page.waitForFunction(
    (f) => Array.from(document.querySelectorAll('.message')).some(
      (m) => (m.textContent ?? '').includes(f),
    ),
    fragment,
    { timeout: delai },
  );
  return page.evaluate(
    (f) => Array.from(document.querySelectorAll('.message'))
      .map((m) => m.textContent ?? '').find((t) => t.includes(f)) ?? '',
    fragment,
  );
}

(async () => {
  const navigateur = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await navigateur.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  page.on('pageerror', (e) => erreurs.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400) {
      const ligne = `${r.status()} ${r.request().method()} ${r.url()}`;
      refusees.push(ligne);
      console.log(`      [refus pendant « ${phase} »] ${ligne}`);
    }
  });

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.fill('#login', 'gerant');
  await page.fill('#mdp', 'GestGlobale2026!');
  await page.click('button.principal');
  await page.waitForSelector('.carte .valeur', { timeout: 15000 });
  etape('Connexion du gerant', true);

  // ---------------------------------------------------------------
  console.log('\n1. Reception fournisseur');

  await page.click('a:has-text("Receptions")');
  await page.waitForSelector('h1:has-text("Receptions")', { timeout: 10000 });
  await page.click('button:has-text("Nouvelle reception")');
  await page.waitForSelector('select', { timeout: 5000 });

  // Fournisseur : premiere option reelle.
  const selects = page.locator('.carte select');
  await selects.nth(0).selectOption({ index: 1 });
  await selects.nth(1).selectOption({ index: 0 });

  // Deux articles ajoutes par la recherche.
  const chercheur = page.locator('input[placeholder*="Scannez ou cherchez"]');
  await chercheur.fill('6130000000017');
  await page.waitForTimeout(700);
  await chercheur.press('Enter');
  await page.waitForTimeout(400);
  await chercheur.fill('Lait');
  await page.waitForTimeout(700);
  await chercheur.press('Enter');
  await page.waitForTimeout(400);

  const nbLignes = await page.locator('.carte table tbody tr').count();
  etape('Deux articles ajoutes a la reception', nbLignes === 2, `${nbLignes} ligne(s)`);

  // Quantites et prix.
  const quantites = page.locator('.carte table tbody tr input').first();
  await quantites.fill('10');
  await page.waitForTimeout(200);


  await page.click('button:has-text("Enregistrer en brouillon")');
  await page.waitForSelector('.modale', { timeout: 15000 });
  etape('Reception enregistree, fenetre de validation ouverte', true);

  const texteModale = await page.textContent('.modale');
  etape('Le CUMP avant et le prix propose sont affiches',
    texteModale.includes('CUMP avant') && texteModale.includes('Prix de vente propose'));

  await page.click('.modale button:has-text("Valider la reception")');
  const messageValidation = await attendreMessage(page, 'validee');
  etape('Reception validee', true, messageValidation.trim());

  const statuts = await page.locator('table tbody tr .etiquette').allTextContents();
  etape('La reception apparait comme validee', statuts.some((s) => s.includes('validee')));

  // Verification par l'API : le stock a bien bouge.
  const jeton = await page.evaluate(() => sessionStorage.getItem('gestglobale.jeton'));
  await page.waitForTimeout(800);
  const mouvements = await fetch(
    'http://localhost:3000/api/v1/stocks/mouvements?type=RECEPTION&taille=10',
    { headers: { Authorization: `Bearer ${jeton}` } },
  ).then((r) => r.json());
  etape('Des mouvements de reception existent en base', mouvements.length >= 2,
    `${mouvements.length} mouvement(s)`);

  // ---------------------------------------------------------------
  console.log('\n2. Inventaire');

  await page.click('a:has-text("Inventaires")');
  await page.waitForSelector('h1:has-text("Inventaires")', { timeout: 10000 });
  await page.click('button:has-text("Ouvrir un inventaire")');
  await page.waitForTimeout(400);
  await page.locator('.carte select').nth(0).selectOption({ index: 1 });
  await page.locator('.carte select').nth(1).selectOption('TOURNANT');
  await page.fill('input[placeholder*="Libelle"]', 'Inventaire du rayon frais');
  await page.click('button:has-text("Ouvrir"):not(:has-text("un inventaire"))');
  await page.waitForSelector('.cartes .carte', { timeout: 15000 });
  etape('Inventaire ouvert, quantites theoriques figees', true);

  const chercheurInv = page.locator('input[placeholder*="Scannez l\'article"]');
  await chercheurInv.fill('6130000000017');
  await page.waitForTimeout(700);
  await chercheurInv.press('Enter');
  await page.waitForTimeout(400);
  // On compte volontairement moins que le theorique, pour provoquer un ecart.
  await page.locator('.carte table tbody tr input').first().fill('5');
  await page.click('button:has-text("Enregistrer 1 comptage")');
  await page.waitForTimeout(1500);

  const texteEcart = await page.textContent('body');
  etape('L\'ecart est calcule et valorise', texteEcart.includes('Ecart valorise'));

  await page.click('button:has-text("Valider l")');
  const messageInv = await attendreMessage(page, 'Inventaire valide');
  etape('Inventaire valide et stock ajuste', true, messageInv.trim());

  await page.waitForTimeout(800);
  const ajustements = await fetch(
    'http://localhost:3000/api/v1/stocks/mouvements?type=AJUSTEMENT_INVENTAIRE&taille=10',
    { headers: { Authorization: `Bearer ${jeton}` } },
  ).then((r) => r.json());
  etape('Un mouvement d\'ajustement a ete genere', ajustements.length >= 1,
    `${ajustements.length} ajustement(s)`);

  // ---------------------------------------------------------------
  console.log('\n3. Tresorerie : depense et transfert');

  await page.click('a:has-text("Tresorerie")');
  await page.waitForSelector('h1:has-text("Tresorerie")', { timeout: 10000 });
  await page.click('button:has-text("Saisir une operation")');
  await page.waitForTimeout(600);
  // Une depense en especes sort d'un compte approvisionne : on vise la
  // banque, qui admet un decouvert, et non un tiroir vide.
  await choisirOption(page.locator('.carte select').first(), 'Banque');
  await page.fill('input[placeholder="Montant en DA"]', '12500');
  await page.fill('input[placeholder="Libelle"]', 'Electricite du mois');
  await page.click('button:has-text("Enregistrer"):not(:has-text("comptage"))');
  const messageDepense = await attendreMessage(page, 'Operation enregistree');
  etape('Depense enregistree', true, messageDepense.trim());

  // Une sortie d'especes superieure au contenu du tiroir doit etre refusee.
  await choisirOption(page.locator('.carte select').first(), 'Tiroir caisse 2');
  await page.fill('input[placeholder="Montant en DA"]', '99999');
  await page.fill('input[placeholder="Libelle"]', 'Sortie impossible');
  await page.click('button:has-text("Enregistrer"):not(:has-text("comptage"))');
  const refus = await attendreMessage(page, 'insuffisantes');
  etape('Une sortie superieure aux especes en caisse est refusee', true, refus.trim());

  await page.click('button:has-text("Transferts")');
  await page.waitForTimeout(800);
  // Le tiroir de la caisse 3 a encaisse les ventes : c'est de la qu'on
  // remet au coffre.
  const selectsTransfert = page.locator('.carte select');
  await choisirOption(selectsTransfert.nth(0), 'Tiroir caisse 3');
  await choisirOption(selectsTransfert.nth(1), 'Coffre');
  await page.fill('input[placeholder="Montant en DA"]', '100');
  await page.fill('input[placeholder="Motif"]', 'Remise au coffre');
  await page.click('button:has-text("Demander le transfert")');
  const messageTransfert = await attendreMessage(page, 'Transfert demande');
  etape('Transfert demande', true, messageTransfert.trim());
  await page.waitForTimeout(800);

  const texteTransfert = await page.textContent('body');
  etape('Transfert en attente de validation', texteTransfert.includes('en attente'));

  // Le gerant a demande le transfert : il ne doit pas pouvoir le valider.
  const boutonValider = page.locator('table button:has-text("Valider")').first();
  const desactive = await boutonValider.isDisabled().catch(() => null);
  etape('Le demandeur ne peut pas valider son propre transfert', desactive === true,
    desactive === null ? 'bouton absent' : `desactive=${desactive}`);

  // ---------------------------------------------------------------
  console.log('\n4. Cloisonnement des droits');

  await page.click('button:has-text("Se deconnecter")');
  await page.waitForSelector('#login', { timeout: 10000 });
  await page.fill('#login', 'magasinier1');
  await page.fill('#mdp', 'GestGlobale2026!');
  await page.click('button.principal');
  await page.waitForSelector('.menu a', { timeout: 15000 });

  const menu = await page.locator('.menu a').allTextContents();
  etape('Le magasinier voit Inventaires', menu.some((m) => m.includes('Inventaires')));
  etape('Le magasinier ne voit pas Tresorerie', !menu.some((m) => m.includes('Tresorerie')));

  await page.goto('http://127.0.0.1:5173/inventaires', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const corpsMag = await page.textContent('body');
  etape('Le magasinier peut saisir mais pas valider',
    corpsMag.includes('seul un responsable peut valider')
      || !corpsMag.includes('Valider l’inventaire'));

  // ---------------------------------------------------------------
  console.log('\n' + '='.repeat(70));
  const ok = etapes.filter((e) => e.ok).length;
  console.log(`Resultat : ${ok} / ${etapes.length} etape(s) reussie(s)`);
  if (refusees.length > 0) {
    console.log(`\nRequetes refusees (${refusees.length}) :`);
    for (const r of refusees) console.log(`  - ${r}`);
  }
  if (erreurs.length > 0) {
    console.log(`\nErreurs console (${erreurs.length}) :`);
    for (const e of erreurs.slice(0, 8)) console.log(`  - ${e}`);
  } else {
    console.log('Aucune erreur console.');
  }
  console.log('='.repeat(70));

  await navigateur.close();
  process.exit(ok === etapes.length && erreurs.length === 0 ? 0 : 1);
})();
