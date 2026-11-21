/**
 * Test de charge au volume reel.
 *
 * Mesure les exigences chiffrees de la section 8 du cahier des charges
 * sur le volume annonce : environ 28 000 articles, 2 caisses, une journee
 * type de 430 tickets.
 *
 *   scan -> affichage ................. < 0,3 s
 *   validation d'un ticket ............ < 1 s, hors ligne comprise
 *   recherche dans 30 000 articles .... < 1 s
 *   rapport mensuel ................... < 5 s
 *
 * Les durees sont donnees en mediane et au 95e centile : une moyenne
 * masquerait les a-coups, qui sont justement ce que ressent le caissier.
 */
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const requis = createRequire(import.meta.url);
const { ouvrirBase } = requis('../dist/principal/base.js');
const { chercherParCode, chercherParTexte } = requis('../dist/principal/catalogue.js');
const { panierVide, ajouterLigne, encaisser, totauxPanier } = requis('../dist/principal/vente.js');
const { ouvrirSession, cloturerSession, previsualiserCloture } = requis('../dist/principal/session.js');
const { Synchronisation, clientHttpParDefaut } = requis('../dist/principal/synchronisation.js');

const BASE_API = process.env.API_BASE ?? 'http://localhost:3000/api/v1';
const NB_TICKETS = Number(process.env.NB_TICKETS ?? 430);

let echecs = 0;
const mesures = [];

function centile(valeurs, p) {
  if (valeurs.length === 0) return 0;
  const triees = [...valeurs].sort((a, b) => a - b);
  return triees[Math.min(triees.length - 1, Math.floor((p / 100) * triees.length))];
}

function verifier(libelle, durees, seuilMs, unite = 'ms') {
  const med = centile(durees, 50);
  const p95 = centile(durees, 95);
  const max = Math.max(...durees);
  const ok = p95 <= seuilMs;
  if (!ok) echecs++;
  mesures.push({ libelle, med, p95, max, seuilMs, ok, nombre: durees.length });
  const etat = ok ? 'OK   ' : 'ECHEC';
  console.log(
    `  ${etat} ${libelle.padEnd(44)} med ${med.toFixed(1).padStart(8)} ${unite}` +
    `   p95 ${p95.toFixed(1).padStart(8)} ${unite}` +
    `   max ${max.toFixed(1).padStart(8)} ${unite}   (seuil ${seuilMs} ${unite})`,
  );
}

function verifierUnique(libelle, dureeMs, seuilMs) {
  verifier(libelle, [dureeMs], seuilMs);
}

async function chrono(action) {
  const debut = performance.now();
  const resultat = await action();
  return { duree: performance.now() - debut, resultat };
}

async function appel(chemin, jeton) {
  const reponse = await fetch(`${BASE_API}${chemin}`, {
    headers: { Authorization: `Bearer ${jeton}` },
  });
  if (!reponse.ok) throw new Error(`${chemin} : ${reponse.status} ${await reponse.text()}`);
  return reponse.json();
}

const titre = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

async function main() {
  console.log(`Test de charge — ${NB_TICKETS} tickets sur 2 caisses, volume reel\n`);

  const gerant = await fetch(`${BASE_API}/auth/connexion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'gerant', motDePasse: 'GestGlobale2026!' }),
  }).then((r) => r.json());

  const caissier = await fetch(`${BASE_API}/auth/connexion-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: '3', pin: '1234' }),
  }).then((r) => r.json());

  // ----------------------------------------------------------------
  titre('1. Descente du catalogue complet vers une caisse neuve');

  const caisses = [];
  for (const numero of [2, 3]) {
    const base = ouvrirBase(':memory:');
    base.prepare(`INSERT INTO etat_sync (cle, valeur) VALUES ('sync.jeton', ?)`)
      .run(caissier.jeton);
    const sync = new Synchronisation(
      base,
      { urlServeur: BASE_API, codeMagasin: 'SV', numeroCaisse: numero },
      clientHttpParDefaut(BASE_API, 120000),
    );
    caisses.push({ numero, base, sync });
  }

  const { duree: dureeDescente, resultat: resumeDescente } = await chrono(() =>
    caisses[0].sync.descendre(),
  );
  const articlesLocaux = caisses[0].base
    .prepare('SELECT COUNT(*) AS n FROM article').get().n;
  const codesLocaux = caisses[0].base
    .prepare('SELECT COUNT(*) AS n FROM code_barre').get().n;

  console.log(`  ${resumeDescente.pages} page(s), ${articlesLocaux.toLocaleString('fr-FR')} articles, ` +
    `${codesLocaux.toLocaleString('fr-FR')} codes-barres, ` +
    `${resumeDescente.clients.toLocaleString('fr-FR')} clients`);
  // Une caisse neuve doit pouvoir etre prete en moins de 3 minutes.
  verifierUnique('Descente complete du catalogue', dureeDescente, 180_000);

  await caisses[1].sync.descendre();

  // ----------------------------------------------------------------
  titre('2. Scan d\'un article — exigence < 0,3 s');

  const codes = caisses[0].base
    .prepare('SELECT code FROM code_barre ORDER BY RANDOM() LIMIT 2000')
    .all().map((l) => l.code);

  const dureesScan = [];
  for (const code of codes) {
    const debut = performance.now();
    const trouve = chercherParCode(caisses[0].base, code);
    dureesScan.push(performance.now() - debut);
    if (!trouve) throw new Error(`Code introuvable en base locale : ${code}`);
  }
  verifier('Scan code-barres (base locale caisse)', dureesScan, 300);

  const dureesTexte = [];
  for (const mot of ['Huile', 'Lait prem', 'Semoule fine', 'Cafe', 'ART0123', 'Yaourt bio']) {
    for (let i = 0; i < 20; i++) {
      const debut = performance.now();
      chercherParTexte(caisses[0].base, mot);
      dureesTexte.push(performance.now() - debut);
    }
  }
  verifier('Recherche par nom (base locale caisse)', dureesTexte, 300);

  // ----------------------------------------------------------------
  titre('3. Journee type — validation d\'un ticket < 1 s');

  const sessions = caisses.map((c) =>
    ouvrirSession(c.base, {
      codeMagasin: 'SV', numeroCaisse: c.numero,
      fondDeCaisseCentimes: 500_000, utilisateurId: caissier.utilisateur.id,
    }).numero,
  );

  const dureesTicket = [];
  let lignesTotal = 0;
  let caTotal = 0;
  const debutJournee = performance.now();

  for (let i = 0; i < NB_TICKETS; i++) {
    const indexCaisse = i % 2;
    const caisse = caisses[indexCaisse];
    const debut = performance.now();

    const panier = panierVide();
    // Panier realiste : 1 a 12 articles, moyenne autour de 5.
    const nbLignes = 1 + Math.floor(Math.random() * 12);
    for (let l = 0; l < nbLignes; l++) {
      const code = codes[(i * 7 + l * 31) % codes.length];
      const trouve = chercherParCode(caisse.base, code);
      if (!trouve || trouve.prixUnitaireCentimes <= 0) continue;
      ajouterLigne(panier, {
        article: trouve.article,
        quantiteMilli: trouve.quantiteMilli,
        prixUnitaireCentimes: trouve.prixUnitaireCentimes,
        codeScanne: trouve.codeScanne,
      });
    }
    if (panier.lignes.length === 0) continue;

    const totaux = totauxPanier(panier, ['ESPECES']);
    const remis = Math.ceil(totaux.totalTtcCentimes / 50_000) * 50_000;
    const resultat = encaisser(
      caisse.base, panier, [{ mode: 'ESPECES', montantCentimes: remis }],
      {
        codeMagasin: 'SV', numeroCaisse: caisse.numero,
        sessionNumero: sessions[indexCaisse],
        utilisateurId: caissier.utilisateur.id, horsLigne: false,
      },
    );

    dureesTicket.push(performance.now() - debut);
    lignesTotal += panier.lignes.length;
    caTotal += resultat.ticket.totalTtcCentimes;
  }

  const dureeJournee = (performance.now() - debutJournee) / 1000;
  console.log(`  ${dureesTicket.length} tickets, ${lignesTotal} lignes, ` +
    `${(caTotal / 100).toLocaleString('fr-FR')} DA, en ${dureeJournee.toFixed(1)} s`);
  verifier('Validation d\'un ticket (scan + encaissement)', dureesTicket, 1000);

  // ----------------------------------------------------------------
  titre('4. Remontee de la journee au serveur');

  const debutRemontee = performance.now();
  let acceptes = 0;
  let refuses = 0;
  for (const caisse of caisses) {
    for (let tour = 0; tour < 60 && caisse.sync.nombreEnAttente() > 0; tour++) {
      const r = await caisse.sync.remonter();
      acceptes += r.acceptes + r.dejaRecus;
      refuses += r.refuses;
    }
  }
  const dureeRemontee = (performance.now() - debutRemontee) / 1000;
  const restants = caisses.reduce((t, c) => t + c.sync.nombreEnAttente(), 0);

  console.log(`  ${acceptes} element(s) acquitte(s) en ${dureeRemontee.toFixed(1)} s ` +
    `(${(acceptes / dureeRemontee).toFixed(0)} par seconde)`);
  if (refuses > 0) {
    console.log(`  ECHEC ${refuses} element(s) refuse(s) par le serveur`);
    echecs++;
  }
  if (restants > 0) {
    console.log(`  ECHEC ${restants} element(s) encore en file`);
    echecs++;
  }

  // ----------------------------------------------------------------
  titre('5. Cloture Z des deux caisses');

  const dureesCloture = [];
  for (let i = 0; i < caisses.length; i++) {
    const apercu = previsualiserCloture(caisses[i].base, sessions[i], []);
    const aCompter = Math.floor(apercu.theoriqueEspecesCentimes / 500) * 500;
    const comptage = [];
    let reste = aCompter;
    for (const coupure of [200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000, 500]) {
      const nombre = Math.floor(reste / coupure);
      if (nombre > 0) { comptage.push({ coupureCentimes: coupure, nombre }); reste -= nombre * coupure; }
    }
    const debut = performance.now();
    cloturerSession(caisses[i].base, {
      sessionNumero: sessions[i], comptage,
      justification: 'Appoint non representable en coupures',
      utilisateurId: caissier.utilisateur.id, horsLigne: false,
    });
    dureesCloture.push(performance.now() - debut);
  }
  verifier('Cloture Z (calcul et ecriture locale)', dureesCloture, 1000);

  for (const caisse of caisses) {
    for (let tour = 0; tour < 10 && caisse.sync.nombreEnAttente() > 0; tour++) {
      await caisse.sync.remonter();
    }
  }

  // ----------------------------------------------------------------
  titre('6. Back-office — recherche dans 30 000 articles < 1 s');

  const requetes = [
    '/articles?taille=50',
    '/articles?texte=Huile&taille=50',
    '/articles?texte=premium&taille=50',
    '/articles?texte=ART12345&taille=50',
    '/articles?texte=Semoule%20fine&taille=50',
    '/articles?archive=false&taille=50',
    '/articles?sansCodeBarre=true&taille=50',
    '/articles?page=400&taille=50',
  ];
  const dureesRecherche = [];
  for (const requete of requetes) {
    for (let i = 0; i < 5; i++) {
      const { duree } = await chrono(() => appel(requete, gerant.jeton));
      dureesRecherche.push(duree);
    }
  }
  verifier('Recherche back-office (30 000 articles)', dureesRecherche, 1000);

  const dureesCode = [];
  for (const code of codes.slice(0, 50)) {
    const { duree } = await chrono(() => appel(`/articles/code/${code}`, gerant.jeton));
    dureesCode.push(duree);
  }
  verifier('Lecture d\'un code par l\'API', dureesCode, 300);

  // ----------------------------------------------------------------
  titre('7. Rapports — exigence < 5 s');

  const dureesJour = [];
  for (let i = 0; i < 5; i++) {
    const { duree } = await chrono(() => appel('/ventes/jour', gerant.jeton));
    dureesJour.push(duree);
  }
  verifier('Tableau de bord du jour', dureesJour, 5000);

  const dureesMois = [];
  for (let i = 0; i < 5; i++) {
    const { duree } = await chrono(() => appel('/rapports/periode', gerant.jeton));
    dureesMois.push(duree);
  }
  verifier('Rapport mensuel (synthese)', dureesMois, 5000);

  const dureesTop = [];
  for (const sens of ['TOP', 'FLOP']) {
    for (let i = 0; i < 3; i++) {
      const { duree } = await chrono(() => appel(`/rapports/produits?sens=${sens}`, gerant.jeton));
      dureesTop.push(duree);
    }
  }
  verifier('Top et flop produits du mois', dureesTop, 5000);

  const { duree: dureeDormants } = await chrono(() =>
    appel('/rapports/dormants?jours=90', gerant.jeton));
  verifierUnique('Produits dormants sur 90 jours', dureeDormants, 5000);

  const { duree: dureeEcarts } = await chrono(() =>
    appel('/caisse/ecarts?jours=30', gerant.jeton));
  verifierUnique('Ecarts de caisse sur 30 jours', dureeEcarts, 5000);

  // Rapports ajoutes par M9. Les ruptures balayent tout le stock, et les
  // ventes a perte toutes les lignes du mois : ce sont les deux qui
  // pouvaient devenir lentes au volume reel.
  const { duree: dureeRuptures } = await chrono(() =>
    appel('/rapports/ruptures', gerant.jeton));
  verifierUnique('Ruptures sur tout le catalogue', dureeRuptures, 5000);

  const { duree: dureePerte } = await chrono(() =>
    appel('/rapports/ventes-a-perte', gerant.jeton));
  verifierUnique('Produits vendus a perte sur le mois', dureePerte, 5000);

  const { duree: dureeEcartsM9 } = await chrono(() =>
    appel('/rapports/ecarts-de-caisse?jours=30', gerant.jeton));
  verifierUnique('Ecarts de caisse par caissier sur 30 jours', dureeEcartsM9, 5000);

  const { duree: dureeJournal } = await chrono(() =>
    appel('/rapports/annulations-et-remises', gerant.jeton));
  verifierUnique('Journal des annulations et remises du mois', dureeJournal, 5000);

  // ----------------------------------------------------------------
  titre('7 bis. Exports Excel et PDF au volume reel');

  // Produire un fichier coute plus que produire du JSON : le classeur
  // est assemble feuille par feuille et le PDF ligne par ligne. Si un
  // export depassait la minute, le gerant renoncerait a s'en servir.
  for (const [nom, libelle] of [
    ['periode', 'Synthese du mois'],
    ['ruptures', 'Ruptures'],
    ['produits', 'Palmares'],
  ]) {
    for (const format of ['xlsx', 'pdf']) {
      const { duree, resultat } = await chrono(async () => {
        const reponse = await fetch(
          `${BASE_API}/rapports/${nom}/export.${format}`,
          { headers: { Authorization: `Bearer ${gerant.jeton}` } },
        );
        if (!reponse.ok) throw new Error(`${nom}.${format} : ${reponse.status}`);
        return Buffer.from(await reponse.arrayBuffer());
      });
      verifierUnique(
        `${libelle} en ${format} (${Math.round(resultat.length / 1024)} Ko)`,
        duree, 10000,
      );
    }
  }

  const { duree: dureeResume } = await chrono(async () => {
    const reponse = await fetch(`${BASE_API}/rapports/resumes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gerant.jeton}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jour: new Date().toISOString().slice(0, 10) }),
    });
    if (!reponse.ok) throw new Error(`resume : ${reponse.status}`);
    return reponse.json();
  });
  verifierUnique('Resume quotidien du gerant', dureeResume, 10000);

  const { duree: dureeAlertes } = await chrono(() => appel('/stocks/alertes', gerant.jeton));
  verifierUnique('Alertes de reassort', dureeAlertes, 5000);

  const { duree: dureeNegatifs } = await chrono(() => appel('/stocks/negatifs', gerant.jeton));
  verifierUnique('Stocks negatifs', dureeNegatifs, 5000);

  // ----------------------------------------------------------------
  titre('8. Descente incrementale apres la journee');

  const { duree: dureeIncrementale } = await chrono(() => caisses[0].sync.descendre());
  // Une descente de rattrapage doit rester quasi instantanee.
  verifierUnique('Descente incrementale (rien a recuperer)', dureeIncrementale, 5000);

  // ----------------------------------------------------------------
  console.log(`\n${'='.repeat(100)}`);
  const total = mesures.length;
  const reussies = mesures.filter((m) => m.ok).length;
  console.log(`Resultat : ${reussies} / ${total} mesure(s) dans les clous` +
    (echecs > 0 ? `, ${echecs} probleme(s)` : ''));
  console.log('='.repeat(100));

  for (const caisse of caisses) caisse.base.close();
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
