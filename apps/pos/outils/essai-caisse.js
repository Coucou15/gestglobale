/**
 * Essai de bout en bout de la caisse, sous Electron.
 *
 * Lance l'application reelle — processus principal, pont de securite et
 * interface — et rejoue une installation complete : configuration du
 * poste, prise de poste, ouverture de caisse, vente, encaissement.
 *
 * C'est le seul controle qui prouve que les trois morceaux fonctionnent
 * ensemble ; les essais precedents n'eprouvaient que les modules, sans
 * Electron.
 *
 *   xvfb-run -a npx electron --no-sandbox outils/essai-caisse.js
 */
const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');
const { mkdtempSync, existsSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');

// Chaque essai part d'un poste vierge : ni configuration, ni base locale.
const dossier = mkdtempSync(join(tmpdir(), 'caisse-essai-'));
process.env.GESTGLOBALE_CONFIG = join(dossier, 'caisse.json');
app.setPath('userData', dossier);

const etapes = [];
const journal = [];
let reussites = 0;

function etape(nom, ok, detail = '') {
  etapes.push({ nom, ok, detail });
  if (ok) reussites++;
  console.log(`ESSAI ${ok ? 'OK   ' : 'ECHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

async function principal() {
  require('../dist/principal/index.js');
  await app.whenReady();
  await new Promise((r) => setTimeout(r, 2500));

  const [fenetre] = BrowserWindow.getAllWindows();
  if (!fenetre) {
    etape('La fenetre de la caisse s’ouvre', false, 'aucune fenetre');
    return terminer();
  }
  etape('La fenetre de la caisse s’ouvre', true);

  fenetre.webContents.on('console-message', (_e, niveau, message) => {
    if (niveau >= 2) journal.push(message);
  });

  const js = (code) => fenetre.webContents.executeJavaScript(code, true);
  const attendre = async (condition, delai = 15000) => {
    const limite = Date.now() + delai;
    while (Date.now() < limite) {
      if (await js(condition)) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };

  // --- 1. Premiere installation ------------------------------------
  etape(
    'Un poste neuf propose l’ecran d’installation',
    await attendre(`!!document.body.innerText.includes('installation de la caisse')`),
  );

  etape(
    'Le pont expose les canaux au rendu',
    await js(`typeof window.caisse === 'object' && typeof window.caisse.encaisser === 'function'`),
  );

  const testServeur = await js(
    `window.caisse.testerServeur('http://localhost:3000/api/v1')`,
  );
  etape('Le test de connexion reconnait le serveur', testServeur.joignable === true,
    testServeur.message ?? '');

  const testFaux = await js(`window.caisse.testerServeur('http://localhost:9999/api/v1')`);
  etape('Une mauvaise adresse est signalee', testFaux.joignable === false,
    testFaux.message ?? '');

  await js(`window.caisse.enregistrerConfiguration({
    urlServeur: 'http://localhost:3000/api/v1',
    codeMagasin: 'SV',
    numeroCaisse: 3,
    raisonSociale: 'Superette Demo',
    adresse: 'Alger',
    rc: '16/00-0000000 B 00',
    nif: '000000000000000',
  })`);
  etape('La configuration est ecrite sur le poste', existsSync(process.env.GESTGLOBALE_CONFIG));

  const ecrite = JSON.parse(readFileSync(process.env.GESTGLOBALE_CONFIG, 'utf8'));
  etape('Elle porte bien le poste declare',
    ecrite.codeMagasin === 'SV' && ecrite.numeroCaisse === 3,
    `${ecrite.codeMagasin}-${ecrite.numeroCaisse}`);

  // --- 2. Mise en service et prise de poste ---------------------------
  //
  // Une caisse neuve n'a ni catalogue ni utilisateur : la premiere
  // connexion passe par le serveur, qui delivre le jeton et declenche la
  // descente. Synchroniser avant d'avoir ouvert une session n'a donc
  // aucun sens, et le serveur le refuse a juste titre.
  const connexion = await js(`window.caisse.connexion('3', '1234')`);
  etape('Le caissier prend son poste par code PIN', connexion.ok === true,
    connexion.ok ? connexion.utilisateur.nom : connexion.message);

  const mauvais = await js(`window.caisse.connexion('3', '0000')`);
  etape('Un PIN faux est refuse', mauvais.ok === false);

  etape('La mise en service a rempli le catalogue local',
    (await js(`window.caisse.chercherTexte('Huile')`)).length > 0);

  const article = await js(`window.caisse.chercherCode('6130000000017')`);
  etape('Un article scanne est retrouve en base locale',
    article?.article?.reference === 'ART0001',
    article?.article?.designation ?? 'introuvable');
  etape('Son prix est descendu', article?.prixUnitaireCentimes === 75000,
    String(article?.prixUnitaireCentimes));

  const session = await js(`window.caisse.ouvrirSession(500000)`);
  etape('La session de caisse s’ouvre', Boolean(session?.numero), session?.numero ?? '');

  const vente = await js(`(async () => {
    const trouve = await window.caisse.chercherCode('6130000000017');
    const panier = {
      lignes: [{
        numeroLigne: 1, article: trouve.article, codeScanne: trouve.codeScanne,
        quantiteMilli: 2000, prixUnitaireCentimes: trouve.prixUnitaireCentimes,
        remisePourcent: 0, remiseCentimes: 0, annulee: false,
        autoriseeParId: null, promotionId: null,
      }],
      clientId: null, categoriePrix: 'DETAIL', remisePiedPourcent: 0,
    };
    return window.caisse.encaisser(panier, [{ mode: 'ESPECES', montantCentimes: 200000 }]);
  })()`);
  etape('Une vente est encaissee', Boolean(vente?.ticket?.numero), vente?.ticket?.numero ?? '');
  etape('Le rendu de monnaie est juste', vente?.renduCentimes === 50000,
    `${(vente?.renduCentimes ?? 0) / 100} DA`);

  // --- Promotions (M10) -------------------------------------------
  const promos = await js(`window.caisse.promotionsEnCours()`);
  etape('Les promotions descendent jusqu\u2019a la caisse', promos.length >= 4,
    `${promos.length} promotion(s)`);

  const prixBarre = await js(`(async () => {
    const t = await window.caisse.chercherCode('6130000000017');
    return window.caisse.promotionsLigne(t.article.id, 1000, t.prixUnitaireCentimes);
  })()`);
  etape('Un prix barre s\u2019applique hors ligne',
    prixBarre.length === 1 && prixBarre[0].prixUnitaireCentimes === 69000,
    prixBarre[0]?.libelle ?? 'aucune');

  const deuxLaits = await js(`(async () => {
    const t = await window.caisse.chercherCode('6130000000048');
    return window.caisse.promotionsLigne(t.article.id, 2000, t.prixUnitaireCentimes);
  })()`);
  etape('Deux laits ne declenchent pas le « trois pour deux »',
    deuxLaits.filter((a) => a.type === 'X_POUR_Y').length === 0);

  const troisLaits = await js(`(async () => {
    const t = await window.caisse.chercherCode('6130000000048');
    return window.caisse.promotionsLigne(t.article.id, 3000, t.prixUnitaireCentimes);
  })()`);
  const offert = troisLaits.find((a) => a.type === 'X_POUR_Y');
  etape('Trois laits en offrent un', offert?.unitesOffertesMilli === 1000,
    offert ? `${offert.unitesOffertesMilli / 1000} offert(s)` : 'aucune');

  // --- Cartes cadeaux et bons d'achat (M10) ---------------------------
  const annee = new Date().getFullYear();
  const carte = `CAD-${annee}-000001`;

  const bonsDescendus = await js(`window.caisse.presenterBon('${carte}', 10000)`);
  etape('La carte cadeau du jeu d’essai est descendue en caisse',
    bonsDescendus?.accepte === true, bonsDescendus?.message ?? '');
  etape('Elle couvre la somme presentee',
    bonsDescendus?.montantUtiliseCentimes === 10000
      && bonsDescendus?.soldeApresCentimes === 90000,
    `${(bonsDescendus?.soldeApresCentimes ?? 0) / 100} DA resteraient`);

  const inconnu = await js(`window.caisse.presenterBon('CAD-1999-999999', 10000)`);
  etape('Un code inconnu de la caisse est refuse, pas honore',
    inconnu?.accepte === false && inconnu?.motif === 'INCONNU', inconnu?.message ?? '');

  const tropGrand = await js(`window.caisse.presenterBon('${carte}', 500000)`);
  etape('Une carte de 1 000 DA ne couvre pas 5 000 DA a elle seule',
    tropGrand?.accepte === true
      && tropGrand?.montantUtiliseCentimes === 100000
      && tropGrand?.resteAPayerCentimes === 400000,
    `reste ${(tropGrand?.resteAPayerCentimes ?? 0) / 100} DA a regler`);

  // Vente payee moitie carte, moitie especes, puis verification que le
  // solde local a bien baisse : une seconde presentation de la meme carte
  // ne doit plus trouver 1 000 DA dessus.
  const venteBon = await js(`(async () => {
    const trouve = await window.caisse.chercherCode('6130000000017');
    const panier = {
      lignes: [{
        numeroLigne: 1, article: trouve.article, codeScanne: trouve.codeScanne,
        quantiteMilli: 2000, prixUnitaireCentimes: trouve.prixUnitaireCentimes,
        remisePourcent: 0, remiseCentimes: 0, annulee: false,
        autoriseeParId: null, promotionId: null,
      }],
      clientId: null, categoriePrix: 'DETAIL', remisePiedPourcent: 0,
    };
    return window.caisse.encaisser(panier, [
      { mode: 'BON_ACHAT', montantCentimes: 100000, reference: '${carte}' },
      { mode: 'ESPECES', montantCentimes: 50000 },
    ]);
  })()`);
  etape('Une vente se regle moitie carte cadeau, moitie especes',
    Boolean(venteBon?.ticket?.numero), venteBon?.ticket?.numero ?? '');

  const apresUsage = await js(`window.caisse.presenterBon('${carte}', 10000)`);
  etape('La carte est epuisee pour la caisse apres son usage',
    apresUsage?.accepte === false && apresUsage?.motif === 'EPUISE',
    apresUsage?.message ?? '');

  const points = await js(`(async () => {
    const trouves = await window.caisse.chercherClient('fidelite');
    return trouves.length > 0 ? window.caisse.pointsClient(trouves[0].id) : null;
  })()`);
  etape('La caisse connait les points du client et leur valeur',
    points?.points === 120 && points?.valeurCentimes === 12000,
    `${points?.points ?? 0} points, ${(points?.valeurCentimes ?? 0) / 100} DA`);

  const impression = await js(`window.caisse.imprimer('${vente?.ticket?.numero}')`);
  etape('Le ticket se compose avec ses mentions legales',
    typeof impression?.texte === 'string' && impression.texte.includes('16/00-0000000 B 00'));

  // --- 4. Remontee ------------------------------------------------------
  const cycle = await js(`window.caisse.synchroniser()`);
  etape('Le ticket remonte au serveur', cycle.remontee?.ok === true,
    `${cycle.remontee?.acceptes ?? 0} accuse(s)`);

  // Le nombre d'accuses de ce cycle ne prouve rien : la caisse
  // synchronise aussi d'elle-meme, et la file peut deja etre vide. On
  // interroge donc le serveur sur l'etat de la carte.
  const auServeur = await (async () => {
    const connexion = await fetch('http://localhost:3000/api/v1/auth/connexion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'gerant', motDePasse: 'GestGlobale2026!' }),
    }).then((r) => r.json());
    const bons = await fetch(
      `http://localhost:3000/api/v1/fidelite/bons?code=${carte}`,
      { headers: { Authorization: `Bearer ${connexion.jeton}` } },
    ).then((r) => r.json());
    return bons[0];
  })();

  etape('Le serveur a bien enregistre le reglement par carte cadeau',
    (auServeur?.utilisations ?? []).length === 1,
    `${(auServeur?.utilisations ?? []).length} utilisation(s)`);
  etape('La carte est a zero au serveur comme en caisse',
    Number(auServeur?.soldeCentimes) === 0, `solde ${auServeur?.soldeCentimes}`);
  // Le montant inscrit au serveur doit etre au centime celui que la
  // caisse a applique : c'est la que se verrait un arrondi silencieux.
  etape('Le montant preleve au serveur est exactement celui de la caisse',
    Number(auServeur?.utilisations?.[0]?.montantCentimes) === 100000,
    `${Number(auServeur?.utilisations?.[0]?.montantCentimes) / 100} DA`);
  etape('Aucun depassement n\u2019est signale sur cette vente',
    Number(auServeur?.utilisations?.[0]?.decouvertCentimes) === 0);

  const etat = await js(`window.caisse.etatSync()`);
  etape('Le voyant repasse au vert', etat.couleur === 'vert',
    `${etat.couleur}, ${etat.enAttente} en attente`);

  await fenetre.webContents.capturePage().then((image) => {
    require('node:fs').writeFileSync(
      process.env.CAPTURE ?? join(dossier, 'caisse.png'), image.toPNG(),
    );
  });

  terminer();
}

function terminer() {
  console.log(`\nESSAI TOTAL ${reussites} / ${etapes.length}`);
  if (journal.length > 0) {
    console.log('ESSAI journal du rendu :');
    for (const m of journal.slice(0, 6)) console.log('  ' + m);
  }
  app.exit(reussites === etapes.length && journal.length === 0 ? 0 : 1);
}

principal().catch((erreur) => {
  console.error('ESSAI exception', erreur);
  app.exit(1);
});
