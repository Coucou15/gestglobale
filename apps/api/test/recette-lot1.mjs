/**
 * Recette du lot 1 — rejoue les criteres du cahier des charges contre une
 * API reellement demarree.
 *
 * Couvre : vente et decrement de stock, code balance au poids, pack,
 * vente a credit avec plafond, cloture Z avec ecart justifie, idempotence
 * de la remontee (aucun doublon), cloisonnement des droits du caissier.
 */
const BASE = process.env.API_BASE ?? 'http://localhost:3000/api/v1';

let reussites = 0;
let echecs = 0;
const anomalies = [];

function verifier(libelle, condition, detail = '') {
  if (condition) {
    reussites++;
    console.log(`  OK   ${libelle}`);
  } else {
    echecs++;
    anomalies.push(`${libelle}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ECHEC ${libelle}${detail ? ` — ${detail}` : ''}`);
  }
}

async function appel(chemin, { methode = 'GET', corps, jeton } = {}) {
  const reponse = await fetch(`${BASE}${chemin}`, {
    method: methode,
    headers: {
      'Content-Type': 'application/json',
      ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
    },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  });
  const texte = await reponse.text();
  let donnees;
  try { donnees = texte ? JSON.parse(texte) : null; } catch { donnees = texte; }
  return { statut: reponse.status, donnees };
}

const titre = (t) => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

async function main() {
  titre('1. Connexion et droits');

  const gerant = await appel('/auth/connexion', {
    methode: 'POST',
    corps: { login: 'gerant', motDePasse: 'GestGlobale2026!' },
  });
  verifier('Le gerant se connecte', gerant.statut === 201 || gerant.statut === 200,
    `statut ${gerant.statut}`);
  const jetonGerant = gerant.donnees?.jeton;

  const caissier = await appel('/auth/connexion-pin', {
    methode: 'POST',
    corps: { code: '3', pin: '1234' },
  });
  verifier('Le caissier se connecte par code PIN', Boolean(caissier.donnees?.jeton));
  const jetonCaissier = caissier.donnees?.jeton;

  const mauvaisPin = await appel('/auth/connexion-pin', {
    methode: 'POST', corps: { code: '3', pin: '9999' },
  });
  verifier('Un PIN faux est rejete', mauvaisPin.statut === 401);

  // Critere de recette : "un caissier sans droit ne peut ni annuler,
  // ni modifier un prix, ni voir les marges".
  const articlesCaissier = await appel('/articles?taille=3', { jeton: jetonCaissier });
  const premier = articlesCaissier.donnees?.articles?.[0];
  verifier('Le caissier consulte le catalogue', articlesCaissier.statut === 200);
  verifier('Le caissier ne voit NI le CUMP NI la marge',
    premier !== undefined && premier.cumpCentimes === undefined && premier.margeCentimes === undefined);

  const articlesGerant = await appel('/articles?taille=3', { jeton: jetonGerant });
  verifier('Le gerant voit le CUMP et la marge',
    articlesGerant.donnees?.articles?.[0]?.cumpCentimes !== undefined);

  const refusPrix = await appel(`/articles/${premier.id}/prix`, {
    methode: 'POST', jeton: jetonCaissier,
    corps: { categorie: 'DETAIL', prixCentimes: 1 },
  });
  verifier('Le caissier ne peut pas modifier un prix', refusPrix.statut === 403,
    `statut ${refusPrix.statut}`);

  const refusAnnulation = await appel('/caisse/tickets/INEXISTANT/annulation', {
    methode: 'POST', jeton: jetonCaissier, corps: { motif: 'essai' },
  });
  verifier('Le caissier ne peut pas annuler un ticket', refusAnnulation.statut === 403);

  titre('2. Ouverture de session de caisse');

  const caisses = await appel('/caisse/caisses', { jeton: jetonGerant });
  const caisse3 = caisses.donnees?.find((c) => c.numero === 3);
  verifier('La caisse n° 3 existe', Boolean(caisse3));

  const session = await appel('/caisse/sessions', {
    methode: 'POST', jeton: jetonGerant,
    corps: { caisseId: caisse3.id, fondDeCaisseCentimes: 500000 },
  });
  verifier('Session ouverte avec fond de caisse de 5 000 DA', Boolean(session.donnees?.numero));
  const numeroSession = session.donnees?.numero;
  const idSession = session.donnees?.id;

  const doubleOuverture = await appel('/caisse/sessions', {
    methode: 'POST', jeton: jetonGerant,
    corps: { caisseId: caisse3.id, fondDeCaisseCentimes: 100000 },
  });
  verifier('Une seconde ouverture est refusee tant que la cloture n\'a pas eu lieu',
    doubleOuverture.statut === 409, `statut ${doubleOuverture.statut}`);

  titre('3. Descente du catalogue vers la caisse');

  const descente = await appel('/sync/descente', {
    methode: 'POST', jeton: jetonCaissier,
    corps: { versionProtocole: 1, codeMagasin: 'SV', numeroCaisse: 3, curseur: null },
  });
  verifier('La caisse recoit le catalogue', (descente.donnees?.articles?.length ?? 0) >= 7,
    `${descente.donnees?.articles?.length} articles`);
  verifier('La caisse recoit les clients', (descente.donnees?.clients?.length ?? 0) >= 5);
  verifier('La caisse recoit les utilisateurs et leurs droits',
    (descente.donnees?.utilisateurs?.length ?? 0) >= 11);
  verifier('Le PIN descend sous forme d\'empreinte, jamais en clair',
    descente.donnees?.utilisateurs?.every((u) => !u.empreintePin || u.empreintePin.startsWith('$argon2')));

  const parReference = Object.fromEntries(
    (descente.donnees?.articles ?? []).map((a) => [a.reference, a]),
  );
  const huile = parReference['ART0001'];
  const pommesTerre = parReference['ART0005'];
  const pack = parReference['PACK0001'];
  verifier('Le pack porte son article de base et son nombre d\'unites',
    pack?.packDeId && pack?.packNbUnites === 12);

  titre('4. Lecture d\'une etiquette balance');

  // 21 + code vrac 00005 + poids 01250 (1,250 kg) + cle EAN.
  const base12 = '210000501250';
  let total = 0;
  for (let i = 0; i < 12; i++) total += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  const codeBalance = base12 + ((10 - (total % 10)) % 10);

  const lecture = await appel(`/articles/code/${codeBalance}`, { jeton: jetonCaissier });
  verifier('Le code balance est reconnu comme code a poids', lecture.donnees?.codePoids === true);
  verifier('Le poids 1,250 kg est extrait', lecture.donnees?.quantiteMilli === 1250,
    `recu ${lecture.donnees?.quantiteMilli}`);
  verifier('L\'article vrac est retrouve',
    lecture.donnees?.article?.reference === 'ART0005');

  titre('5. Remontee des tickets');

  const stockAvant = await appel(`/stocks/article/${huile.id}`, { jeton: jetonGerant });
  const svAvant = stockAvant.donnees?.emplacements?.find((e) => e.code === 'SV')?.quantiteMilli;
  const laitAvant = await appel(`/stocks/article/${pack.packDeId}`, { jeton: jetonGerant });
  const laitSvAvant = laitAvant.donnees?.emplacements?.find((e) => e.code === 'SV')?.quantiteMilli;

  const clients = await appel('/tiers?type=CLIENT', { jeton: jetonGerant });
  const clientPro = clients.donnees?.tiers?.find((t) => t.code === 'C0001');

  const utilisateurCaissier = descente.donnees.utilisateurs.find((u) => u.code === '3');

  function ticket(numero, lignes, reglements, extra = {}) {
    const totalHt = lignes.reduce((t, l) => t + l.totalHtCentimes, 0);
    const totalTtc = lignes.reduce((t, l) => t + l.totalTtcCentimes, 0);
    return {
      numero, sessionCaisseNumero: numeroSession, type: 'VENTE',
      dateVente: new Date().toISOString(), utilisateurId: utilisateurCaissier.id,
      clientId: null, lignes, reglements,
      totalHtCentimes: totalHt, totalTvaCentimes: totalTtc - totalHt,
      timbreCentimes: 0, totalTtcCentimes: totalTtc, remisePiedCentimes: 0,
      renduCentimes: 0, horsLigne: false, prixPerime: false,
      ticketOrigineNumero: null, forcageSuperviseurId: null, ...extra,
    };
  }

  function ligne(n, article, quantiteMilli, prix) {
    const ttc = Math.round((quantiteMilli * prix) / 1000);
    return {
      numeroLigne: n, articleId: article.id, codeScanne: article.codesBarres[0] ?? null,
      designation: article.designation, quantiteMilli, prixUnitaireCentimes: prix,
      remisePourcent: 0, remiseCentimes: 0, tauxTva: article.tauxTva,
      totalHtCentimes: ttc, totalTtcCentimes: ttc, cumpCentimes: article.cumpCentimes,
      annulee: false, autoriseeParUtilisateurId: null, promotionId: null,
    };
  }

  // Ticket 1 : especes, 2 huiles + 1,250 kg de pommes de terre.
  const t1 = ticket('SV-03-000001',
    [
      ligne(1, huile, 2000, huile.prixDetailCentimes),
      ligne(2, pommesTerre, 1250, pommesTerre.prixDetailCentimes),
    ],
    [{ mode: 'ESPECES', montantCentimes: 0, reference: null }],
  );
  t1.reglements[0].montantCentimes = t1.totalTtcCentimes;

  // Ticket 2 : un pack de 12 laits, paiement par carte.
  const t2 = ticket('SV-03-000002',
    [ligne(1, pack, 1000, 148000)],
    [{ mode: 'CARTE', montantCentimes: 148000, reference: 'TPE-0001' }],
  );

  // Ticket 3 : vente a credit au client professionnel.
  const t3 = ticket('SV-03-000003',
    [ligne(1, huile, 10000, huile.prixGrosCentimes ?? huile.prixDetailCentimes)],
    [{ mode: 'CREDIT', montantCentimes: 0, reference: null }],
    { clientId: clientPro.id },
  );
  t3.reglements[0].montantCentimes = t3.totalTtcCentimes;

  const remontee = await appel('/sync/remontee', {
    methode: 'POST', jeton: jetonCaissier,
    corps: {
      versionProtocole: 1, codeMagasin: 'SV', numeroCaisse: 3,
      sessions: [], tickets: [t1, t2, t3], clotures: [], mouvements: [],
    },
  });
  const accuses = remontee.donnees?.tickets ?? [];
  verifier('Les 3 tickets sont acceptes',
    accuses.length === 3 && accuses.every((a) => a.statut === 'ACCEPTE'),
    JSON.stringify(accuses.map((a) => `${a.numero}:${a.statut}${a.erreur ? ` (${a.erreur})` : ''}`)));

  titre('6. Idempotence : aucun doublon apres un accuse perdu');

  const renvoi = await appel('/sync/remontee', {
    methode: 'POST', jeton: jetonCaissier,
    corps: {
      versionProtocole: 1, codeMagasin: 'SV', numeroCaisse: 3,
      sessions: [], tickets: [t1, t2, t3], clotures: [], mouvements: [],
    },
  });
  verifier('Le renvoi des memes tickets est reconnu, pas redouble',
    (renvoi.donnees?.tickets ?? []).every((a) => a.statut === 'DEJA_RECU'));

  const ventes = await appel('/ventes/jour', { jeton: jetonGerant });
  verifier('Le serveur ne compte que 3 tickets apres le double envoi',
    ventes.donnees?.nombreTickets === 3, `compte ${ventes.donnees?.nombreTickets}`);

  titre('7. Effet sur les stocks');

  const stockApres = await appel(`/stocks/article/${huile.id}`, { jeton: jetonGerant });
  const svApres = stockApres.donnees?.emplacements?.find((e) => e.code === 'SV')?.quantiteMilli;
  verifier('Le stock d\'huile baisse de 12 unites (2 au detail + 10 en gros)',
    svAvant - svApres === 12000, `avant ${svAvant}, apres ${svApres}`);

  const laitApres = await appel(`/stocks/article/${pack.packDeId}`, { jeton: jetonGerant });
  const laitSvApres = laitApres.donnees?.emplacements?.find((e) => e.code === 'SV')?.quantiteMilli;
  verifier('La vente d\'un pack decremente 12 unites de lait',
    laitSvAvant - laitSvApres === 12000, `avant ${laitSvAvant}, apres ${laitSvApres}`);

  titre('8. Credit client');

  const releve = await appel(`/tiers/${clientPro.id}/releve`, { jeton: jetonGerant });
  verifier('La dette du client professionnel est enregistree',
    releve.donnees?.tiers?.soldeCentimes === t3.totalTtcCentimes,
    `solde ${releve.donnees?.tiers?.soldeCentimes} attendu ${t3.totalTtcCentimes}`);

  const creditExcessif = await appel(
    `/tiers/${clientPro.id}/credit?montantCentimes=99000000`, { jeton: jetonGerant });
  verifier('Un credit au-dela du plafond est refuse',
    creditExcessif.donnees?.autorise === false
      && creditExcessif.donnees?.motif === 'PLAFOND_DEPASSE');
  verifier('Le depassement reste forcable par un superviseur',
    creditExcessif.donnees?.forcagePossible === true);

  titre('9. Cloture Z avec ecart');

  const totaux = await appel(`/caisse/sessions/${idSession}/totaux`, { jeton: jetonGerant });
  const especesTheoriques = (totaux.donnees?.theoriques ?? [])
    .find((t) => t.mode === 'ESPECES')?.montantCentimes ?? 0;
  const theorique = 500000 + especesTheoriques;

  // Comptage volontairement court, pour verifier que l'ecart est calcule.
  //
  // Note metier : le theorique peut comporter une fraction inferieure a la
  // plus petite coupure (5 DA), car un total de ticket tombe sur n'importe
  // quel centime. Un comptage physique ne peut donc jamais egaler un tel
  // theorique : l'ecart est alors structurel et non une erreur de caissier.
  // C'est exactement ce que la cloture doit rendre visible.
  const manquantVise = 50000;
  const aCompter = Math.floor((theorique - manquantVise) / 500) * 500;
  const comptage = [];
  let reste = aCompter;
  for (const coupure of [200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000, 500]) {
    const nombre = Math.floor(reste / coupure);
    if (nombre > 0) { comptage.push({ coupureCentimes: coupure, nombre }); reste -= nombre * coupure; }
  }
  const compteReel = aCompter - reste;
  const ecartAttendu = compteReel - theorique;
  verifier('Le comptage se decompose entierement en coupures reelles', reste === 0,
    `reliquat ${reste}`);
  verifier('Le theorique comporte une fraction non representable en coupures',
    theorique % 500 !== 0,
    'cas attendu : un total de ticket tombe sur un centime quelconque');

  const apercu = await appel(`/caisse/sessions/${idSession}/cloture/previsualiser`, {
    methode: 'POST', jeton: jetonGerant, corps: { comptage },
  });
  verifier('La previsualisation calcule l\'ecart exact',
    apercu.donnees?.ecartEspecesCentimes === ecartAttendu,
    `ecart ${apercu.donnees?.ecartEspecesCentimes}, attendu ${ecartAttendu}`);
  verifier('Une justification est exigee des qu\'il y a un ecart',
    apercu.donnees?.justificationRequise === true);

  const sansJustif = await appel(`/caisse/sessions/${idSession}/cloture`, {
    methode: 'POST', jeton: jetonGerant, corps: { comptage },
  });
  verifier('La cloture est refusee sans justification de l\'ecart',
    sansJustif.statut === 400, `statut ${sansJustif.statut}`);

  const cloture = await appel(`/caisse/sessions/${idSession}/cloture`, {
    methode: 'POST', jeton: jetonGerant,
    corps: { comptage, justification: 'Erreur de rendu de monnaie en fin de service' },
  });
  verifier('La cloture aboutit avec justification',
    cloture.donnees?.cloture?.numero !== undefined);
  verifier('L\'ecart est bien enregistre, pas remis a zero',
    cloture.donnees?.resultat?.ecartEspecesCentimes === ecartAttendu
      && cloture.donnees?.resultat?.ecartEspecesCentimes !== 0);
  verifier('La recette physique n\'est jamais nulle quand il y a eu des ventes',
    cloture.donnees?.resultat?.compteEspecesCentimes > 0);

  const reouverture = await appel('/caisse/sessions', {
    methode: 'POST', jeton: jetonGerant,
    corps: { caisseId: caisse3.id, fondDeCaisseCentimes: 500000 },
  });
  verifier('Une nouvelle session peut s\'ouvrir apres la cloture',
    reouverture.statut === 201 || reouverture.statut === 200);

  titre('10. Journal d\'audit');

  const audit = await appel('/audit?taille=5', { jeton: jetonGerant });
  verifier('Le journal d\'audit enregistre les actions', (audit.donnees?.total ?? 0) > 0,
    `${audit.donnees?.total} entrees`);

  const integrite = await appel('/audit/integrite', { jeton: jetonGerant });
  verifier('La chaine d\'empreintes du journal est intacte',
    integrite.donnees?.intact === true);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Resultat : ${reussites} verification(s) reussie(s), ${echecs} echec(s)`);
  if (anomalies.length > 0) {
    console.log('\nAnomalies :');
    for (const a of anomalies) console.log(`  - ${a}`);
  }
  console.log('='.repeat(60));
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
