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

  titre('9. Fidelite, cartes cadeaux et bons d\'achat (M10)');

  // Le bareme du jeu d'essai : 1 point par 100 DA, un point vaut 1 DA.
  const bareme = await appel('/fidelite/bareme', { jeton: jetonGerant });
  verifier('Le bareme de fidelite est lisible',
    bareme.donnees?.actif === true && bareme.donnees?.centimesParPoint === 10000,
    JSON.stringify(bareme.donnees));

  const clientFidele = clients.donnees?.tiers?.find((t) => t.code === 'C0002');
  const pointsAvant = await appel(`/fidelite/points/${clientFidele.id}`, { jeton: jetonGerant });

  // Un ticket de 2 000 DA au client fidele : 20 points.
  const tFid = ticket('SV-03-000004',
    [ligne(1, huile, 2000, huile.prixDetailCentimes)],
    [{ mode: 'CARTE', montantCentimes: 0, reference: 'TPE-0002' }],
    { clientId: clientFidele.id },
  );
  tFid.reglements[0].montantCentimes = tFid.totalTtcCentimes;
  await appel('/sync/remontee', {
    methode: 'POST', jeton: jetonCaissier,
    corps: {
      versionProtocole: 1, codeMagasin: 'SV', numeroCaisse: 3,
      sessions: [], tickets: [tFid], clotures: [], mouvements: [],
    },
  });

  const pointsApres = await appel(`/fidelite/points/${clientFidele.id}`, { jeton: jetonGerant });
  const gagnes = Math.floor(tFid.totalTtcCentimes / 10000);
  verifier('Le ticket credite les points du client',
    pointsApres.donnees?.points === (pointsAvant.donnees?.points ?? 0) + gagnes,
    `${pointsAvant.donnees?.points} -> ${pointsApres.donnees?.points}, attendu +${gagnes}`);

  // Rejouer le meme ticket ne doit pas crediter une seconde fois.
  await appel('/sync/remontee', {
    methode: 'POST', jeton: jetonCaissier,
    corps: {
      versionProtocole: 1, codeMagasin: 'SV', numeroCaisse: 3,
      sessions: [], tickets: [tFid], clotures: [], mouvements: [],
    },
  });
  const pointsRejeu = await appel(`/fidelite/points/${clientFidele.id}`, { jeton: jetonGerant });
  verifier('Un ticket renvoye ne credite pas les points deux fois',
    pointsRejeu.donnees?.points === pointsApres.donnees?.points,
    `${pointsApres.donnees?.points} -> ${pointsRejeu.donnees?.points}`);

  // Conversion des points en bon : c'est ainsi qu'ils se depensent.
  const conversion = await appel(`/fidelite/points/${clientFidele.id}/conversion`, {
    methode: 'POST', jeton: jetonGerant, corps: { points: 100 },
  });
  verifier('Les points se convertissent en bon d\'achat',
    conversion.donnees?.bon?.code !== undefined
      && Number(conversion.donnees?.montantCentimes) === 100 * bareme.donnees.valeurPointCentimes,
    JSON.stringify({ code: conversion.donnees?.bon?.code, montant: conversion.donnees?.montantCentimes }));

  const pointsConvertis = await appel(`/fidelite/points/${clientFidele.id}`, { jeton: jetonGerant });
  verifier('Les points convertis sont retires du solde',
    pointsConvertis.donnees?.points === pointsRejeu.donnees.points - 100,
    `${pointsRejeu.donnees?.points} -> ${pointsConvertis.donnees?.points}`);

  const tropDePoints = await appel(`/fidelite/points/${clientFidele.id}/conversion`, {
    methode: 'POST', jeton: jetonGerant, corps: { points: 100000 },
  });
  verifier('On ne convertit pas plus de points que le client n\'en a',
    tropDePoints.statut === 400, `statut ${tropDePoints.statut}`);

  // Emission d'une carte cadeau, puis vente payee avec.
  const emission = await appel('/fidelite/bons', {
    methode: 'POST', jeton: jetonGerant,
    corps: { type: 'CARTE_CADEAU', montantCentimes: 200000, nombre: 2 },
  });
  verifier('Le gerant emet deux cartes cadeaux de 2 000 DA',
    Array.isArray(emission.donnees) && emission.donnees.length === 2,
    JSON.stringify(emission.donnees?.map?.((b) => b.code)));
  const carte = emission.donnees?.[0];

  const refusCaissier = await appel('/fidelite/bons', {
    methode: 'POST', jeton: jetonCaissier,
    corps: { type: 'CARTE_CADEAU', montantCentimes: 100000 },
  });
  verifier('Un caissier ne peut pas emettre de carte cadeau',
    refusCaissier.statut === 403, `statut ${refusCaissier.statut}`);

  // La carte descend vers les caisses avec son solde.
  const descenteBons = await appel('/sync/descente', {
    methode: 'POST', jeton: jetonCaissier,
    corps: { versionProtocole: 1, codeMagasin: 'SV', numeroCaisse: 3, curseur: null },
  });
  const carteDescendue = (descenteBons.donnees?.bons ?? []).find((b) => b.code === carte.code);
  verifier('La carte cadeau descend vers la caisse avec son solde',
    carteDescendue !== undefined && carteDescendue.soldeCentimes === 200000,
    JSON.stringify(carteDescendue));

  // Vente de 1 000 DA payee par la carte : il doit rester 1 000 DA dessus.
  const tBon = ticket('SV-03-000005',
    [ligne(1, huile, 1000, huile.prixDetailCentimes)],
    [{ mode: 'BON_ACHAT', montantCentimes: 0, reference: carte.code }],
  );
  tBon.reglements[0].montantCentimes = tBon.totalTtcCentimes;
  const envoiBon = await appel('/sync/remontee', {
    methode: 'POST', jeton: jetonCaissier,
    corps: {
      versionProtocole: 1, codeMagasin: 'SV', numeroCaisse: 3,
      sessions: [], tickets: [tBon], clotures: [], mouvements: [],
    },
  });
  verifier('Une vente payee par carte cadeau est acceptee',
    (envoiBon.donnees?.tickets ?? [])[0]?.statut === 'ACCEPTE',
    JSON.stringify(envoiBon.donnees?.tickets));

  const apresUsage = await appel(`/fidelite/bons?code=${carte.code}`, { jeton: jetonGerant });
  const bonApres = apresUsage.donnees?.[0];
  verifier('Le solde de la carte est diminue du montant paye',
    Number(bonApres?.soldeCentimes) === 200000 - tBon.totalTtcCentimes,
    `solde ${bonApres?.soldeCentimes}, attendu ${200000 - tBon.totalTtcCentimes}`);

  // Scenario redoute : deux caisses hors ligne acceptent la meme carte.
  // Le solde restant ne couvre qu'une partie ; la vente tient quand meme
  // et l'ecart doit etre signale, jamais efface.
  const resteSurLaCarte = Number(bonApres.soldeCentimes);
  const tDouble = ticket('SV-03-000006',
    [ligne(1, huile, 3000, huile.prixDetailCentimes)],
    [{ mode: 'BON_ACHAT', montantCentimes: 0, reference: carte.code }],
    { horsLigne: true },
  );
  tDouble.reglements[0].montantCentimes = tDouble.totalTtcCentimes;
  const envoiDouble = await appel('/sync/remontee', {
    methode: 'POST', jeton: jetonCaissier,
    corps: {
      versionProtocole: 1, codeMagasin: 'SV', numeroCaisse: 3,
      sessions: [], tickets: [tDouble], clotures: [], mouvements: [],
    },
  });
  verifier('Une vente hors ligne payee au-dela du solde n\'est pas refusee',
    (envoiDouble.donnees?.tickets ?? [])[0]?.statut === 'ACCEPTE',
    JSON.stringify(envoiDouble.donnees?.tickets));

  const decouverts = await appel('/fidelite/bons/decouverts', { jeton: jetonGerant });
  const decouvert = (decouverts.donnees ?? []).find((d) => d.documentNumero === tDouble.numero);
  const manquant = tDouble.totalTtcCentimes - resteSurLaCarte;
  verifier('Le depassement est signale au gerant, au centime',
    decouvert !== undefined && Number(decouvert.decouvertCentimes) === manquant,
    `signale ${decouvert?.decouvertCentimes}, attendu ${manquant}`);

  const videe = await appel(`/fidelite/bons?code=${carte.code}`, { jeton: jetonGerant });
  verifier('La carte est a zero, jamais en negatif',
    Number(videe.donnees?.[0]?.soldeCentimes) === 0,
    `solde ${videe.donnees?.[0]?.soldeCentimes}`);

  // Idempotence : le meme ticket renvoye ne redebite pas le bon.
  await appel('/sync/remontee', {
    methode: 'POST', jeton: jetonCaissier,
    corps: {
      versionProtocole: 1, codeMagasin: 'SV', numeroCaisse: 3,
      sessions: [], tickets: [tBon], clotures: [], mouvements: [],
    },
  });
  const apresRejeu = await appel(`/fidelite/bons?code=${carte.code}`, { jeton: jetonGerant });
  verifier('Un ticket renvoye ne debite pas le bon une seconde fois',
    (apresRejeu.donnees?.[0]?.utilisations ?? []).length === 2,
    `${(apresRejeu.donnees?.[0]?.utilisations ?? []).length} utilisation(s)`);
  verifier('L\'ecran du gerant recoit le detail de chaque passage du bon',
    (apresRejeu.donnees?.[0]?.utilisations ?? [])
      .every((u) => u.documentNumero !== undefined && u.decouvertCentimes !== undefined));

  // Annulation d'une carte perdue.
  const carte2 = emission.donnees?.[1];
  const annulation = await appel(`/fidelite/bons/${carte2.id}/annulation`, {
    methode: 'POST', jeton: jetonGerant, corps: { motif: 'Carte perdue par le client' },
  });
  verifier('Une carte perdue peut etre annulee',
    annulation.statut === 200 || annulation.statut === 201, `statut ${annulation.statut}`);

  const tAnnule = ticket('SV-03-000007',
    [ligne(1, huile, 1000, huile.prixDetailCentimes)],
    [{ mode: 'BON_ACHAT', montantCentimes: 0, reference: carte2.code }],
  );
  tAnnule.reglements[0].montantCentimes = tAnnule.totalTtcCentimes;
  const envoiAnnule = await appel('/sync/remontee', {
    methode: 'POST', jeton: jetonCaissier,
    corps: {
      versionProtocole: 1, codeMagasin: 'SV', numeroCaisse: 3,
      sessions: [], tickets: [tAnnule], clotures: [], mouvements: [],
    },
  });
  // La vente a eu lieu : elle tient. Mais la carte annulee ne couvre rien,
  // donc la totalite doit apparaitre en depassement.
  verifier('Une vente payee avec une carte annulee tient, et le manque est signale',
    (envoiAnnule.donnees?.tickets ?? [])[0]?.statut === 'ACCEPTE',
    JSON.stringify(envoiAnnule.donnees?.tickets));
  const decouverts2 = await appel('/fidelite/bons/decouverts', { jeton: jetonGerant });
  const dAnnule = (decouverts2.donnees ?? []).find((d) => d.documentNumero === tAnnule.numero);
  verifier('Le montant paye avec une carte annulee est integralement signale',
    dAnnule !== undefined && Number(dAnnule.decouvertCentimes) === tAnnule.totalTtcCentimes,
    `signale ${dAnnule?.decouvertCentimes}, attendu ${tAnnule.totalTtcCentimes}`);

  // Le solde d'une carte annulee ne doit pas partir : si elle a ete
  // declaree perdue, le client en recevra une autre pour le meme montant.
  const carte2Apres = await appel(`/fidelite/bons?code=${carte2.code}`, { jeton: jetonGerant });
  verifier('Le solde d\'une carte annulee reste intact malgre la vente',
    Number(carte2Apres.donnees?.[0]?.soldeCentimes) === 200000,
    `solde ${carte2Apres.donnees?.[0]?.soldeCentimes}, attendu 200000`);

  titre('10. Cloture Z avec ecart');

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

  titre('11. Rapports, exports et resume quotidien (M9)');

  const moisDebut = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), 1));
  const moisFin = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth() + 1, 1));
  const surLeMois = `debut=${moisDebut.toISOString()}&fin=${moisFin.toISOString()}`;

  const synthese = await appel(`/rapports/periode?${surLeMois}`, { jeton: jetonGerant });
  verifier('La synthese de periode repond', synthese.statut === 200);

  // La section 9 exige le CA par jour, heure, caisse, caissier, magasin,
  // rayon et famille. On verifie que chaque axe est bien la.
  for (const axe of ['parJour', 'parHeure', 'parCaisse', 'parCaissier', 'parFamille']) {
    verifier(`La synthese porte l\'axe « ${axe} »`,
      Array.isArray(synthese.donnees?.[axe]) && synthese.donnees[axe].length > 0,
      JSON.stringify(synthese.donnees?.[axe]?.[0] ?? null)?.slice(0, 80));
  }

  // Les axes doivent se recouper : la somme par caisse doit faire le total.
  const sommeParCaisse = (synthese.donnees?.parCaisse ?? [])
    .reduce((t, c) => t + Number(c.chiffreAffairesCentimes), 0);
  verifier('La somme par caisse egale le chiffre d\'affaires total',
    sommeParCaisse === Number(synthese.donnees?.chiffreAffairesTtcCentimes),
    `${sommeParCaisse} contre ${synthese.donnees?.chiffreAffairesTtcCentimes}`);

  const sommeParHeure = (synthese.donnees?.parHeure ?? [])
    .reduce((t, h) => t + Number(h.chiffreAffairesCentimes), 0);
  verifier('La somme par heure egale le chiffre d\'affaires total',
    sommeParHeure === Number(synthese.donnees?.chiffreAffairesTtcCentimes),
    `${sommeParHeure} contre ${synthese.donnees?.chiffreAffairesTtcCentimes}`);

  const panier = Math.round(
    Number(synthese.donnees.chiffreAffairesTtcCentimes) / synthese.donnees.nombreTickets,
  );
  verifier('Le panier moyen est le quotient exact',
    synthese.donnees.panierMoyenCentimes === panier,
    `${synthese.donnees.panierMoyenCentimes} contre ${panier}`);

  const ruptures = await appel('/rapports/ruptures', { jeton: jetonGerant });
  verifier('Les ruptures sont listees', ruptures.statut === 200
    && Array.isArray(ruptures.donnees));
  verifier('Une rupture se distingue d\'un franchissement de seuil',
    (ruptures.donnees ?? []).every((r) => r.rupture === (r.stockMilli <= 0)));

  const perte = await appel(`/rapports/ventes-a-perte?${surLeMois}`, { jeton: jetonGerant });
  verifier('Les ventes a perte sont calculees', perte.statut === 200);
  verifier('Aucune vente du jeu d\'essai n\'est sous son CUMP',
    perte.donnees?.nombreLignes === 0, `${perte.donnees?.nombreLignes} ligne(s)`);

  const ecarts = await appel('/rapports/ecarts-de-caisse?jours=30', { jeton: jetonGerant });
  verifier('Les ecarts de caisse sont repartis par caissier',
    ecarts.statut === 200 && (ecarts.donnees?.parCaissier?.length ?? 0) > 0);

  // La cloture du chapitre 10 a laisse un ecart volontaire : il doit se
  // retrouver ici au centime, et porter sa justification.
  const clotureVue = (ecarts.donnees?.clotures ?? [])
    .find((z) => z.numero === cloture.donnees?.cloture?.numero);
  verifier('L\'ecart de la cloture Z se retrouve dans le rapport, au centime',
    clotureVue !== undefined
      && Number(clotureVue.ecartCentimes) === ecartAttendu,
    `${clotureVue?.ecartCentimes} contre ${ecartAttendu}`);
  verifier('Sa justification est conservee',
    typeof clotureVue?.justification === 'string' && clotureVue.justification.length > 0,
    clotureVue?.justification ?? '');
  verifier('Elle n\'est donc pas comptee comme non justifiee',
    (ecarts.donnees?.parCaissier ?? []).every((p) => p.nombreNonJustifies === 0));

  const journal = await appel(`/rapports/annulations-et-remises?${surLeMois}`,
    { jeton: jetonGerant });
  verifier('Le journal des annulations et remises repond', journal.statut === 200);
  verifier('Il distingue les remises par caissier du detail ligne a ligne',
    Array.isArray(journal.donnees?.remisesParCaissier)
      && Array.isArray(journal.donnees?.remises)
      && Array.isArray(journal.donnees?.annulations));

  // Un caissier ne doit pas pouvoir lire les rapports du magasin.
  const refuse = await appel('/rapports/ecarts-de-caisse', { jeton: jetonCaissier });
  verifier('Un caissier n\'accede pas aux rapports du magasin',
    refuse.statut === 403, `statut ${refuse.statut}`);

  titre('12. Exports Excel et PDF (M9)');

  const RAPPORTS = [
    'periode', 'produits', 'dormants', 'ruptures',
    'ventes-a-perte', 'ecarts-de-caisse', 'annulations-et-remises',
  ];

  for (const nom of RAPPORTS) {
    for (const format of ['xlsx', 'pdf']) {
      const reponse = await fetch(
        `${BASE}/rapports/${nom}/export.${format}?${surLeMois}`,
        { headers: { Authorization: `Bearer ${jetonGerant}` } },
      );
      const octets = Buffer.from(await reponse.arrayBuffer());
      // Signature du format : un fichier vide ou du JSON d'erreur ne
      // passerait pas, alors qu'un simple code 200 ne dit rien.
      const signature = format === 'xlsx'
        ? octets.subarray(0, 2).toString() === 'PK'
        : octets.subarray(0, 5).toString() === '%PDF-';
      verifier(`${nom}.${format} est un fichier ${format} valide`,
        reponse.status === 200 && signature && octets.length > 500,
        `${reponse.status}, ${octets.length} octets`);

      const disposition = reponse.headers.get('content-disposition') ?? '';
      if (nom === 'periode') {
        verifier(`${format} : le fichier est propose au telechargement, nomme sans accent`,
          /attachment; filename="[a-z0-9-]+\.(xlsx|pdf)"/.test(disposition),
          disposition);
      }
    }
  }

  const formatInconnu = await appel('/rapports/periode/export.csv', { jeton: jetonGerant });
  verifier('Un format inconnu est refuse avec une explication',
    formatInconnu.statut === 400
      && String(formatInconnu.donnees?.message ?? '').includes('xlsx'),
    formatInconnu.donnees?.message ?? '');

  const rapportInconnu = await appel('/rapports/inexistant/export.pdf', { jeton: jetonGerant });
  verifier('Un rapport inconnu est refuse en nommant les rapports offerts',
    rapportInconnu.statut === 400
      && String(rapportInconnu.donnees?.message ?? '').includes('ruptures'),
    String(rapportInconnu.donnees?.message ?? '').slice(0, 60));

  const periodeInverse = await appel(
    '/rapports/periode?debut=2026-12-01T00:00:00Z&fin=2026-11-01T00:00:00Z',
    { jeton: jetonGerant },
  );
  verifier('Une periode a l\'envers est refusee, pas silencieusement vide',
    periodeInverse.statut === 400, `statut ${periodeInverse.statut}`);

  titre('13. Resume quotidien du gerant (M9)');

  const aujourdhui = new Date().toISOString().slice(0, 10);
  const resume = await appel('/rapports/resumes', {
    methode: 'POST', jeton: jetonGerant, corps: { jour: aujourdhui },
  });
  verifier('Le resume du jour se produit a la demande',
    resume.statut === 201 || resume.statut === 200, `statut ${resume.statut}`);
  verifier('Il porte la recette du jour',
    String(resume.donnees?.texte ?? '').includes('Recette TTC'));
  verifier('Il porte les points de vigilance',
    ['Points de vigilance', 'Ecart de caisse', 'Ruptures']
      .every((t) => String(resume.donnees?.texte ?? '').includes(t)));
  verifier('Les modes de reglement y sont nommes en clair, comme sur le ticket',
    String(resume.donnees?.texte ?? '').includes('Especes')
      && !String(resume.donnees?.texte ?? '').includes('BON_ACHAT'));

  // Sans relais de messagerie, le resume existe quand meme et dit
  // pourquoi il n'est pas parti : c'est le defaut qu'on veut eviter.
  verifier('Faute de relais, le resume est conserve et la raison consignee',
    resume.donnees?.envoyeLe === null
      && typeof resume.donnees?.erreurEnvoi === 'string'
      && resume.donnees.erreurEnvoi.length > 0,
    resume.donnees?.erreurEnvoi ?? '');

  const rejeuResume = await appel('/rapports/resumes', {
    methode: 'POST', jeton: jetonGerant, corps: { jour: aujourdhui },
  });
  verifier('Reproduire le resume du meme jour ne cree pas de doublon',
    rejeuResume.donnees?.id === resume.donnees?.id,
    `${resume.donnees?.id} puis ${rejeuResume.donnees?.id}`);

  const liste = await appel('/rapports/resumes', { jeton: jetonGerant });
  verifier('Le gerant retrouve ses resumes dans le back-office',
    Array.isArray(liste.donnees) && liste.donnees.length >= 1,
    `${liste.donnees?.length} resume(s)`);

  const reglages = await appel('/rapports/resumes/reglages', { jeton: jetonGerant });
  verifier('Les reglages d\'envoi sont lisibles',
    reglages.statut === 200 && typeof reglages.donnees?.actif === 'boolean');
  verifier('Le mot de passe du relais n\'est jamais renvoye',
    reglages.donnees?.motDePasse === undefined,
    'seul « motDePasseEnregistre » est expose');

  titre('14. Transferts inter-magasins (M11)');

  const magasins = await appel('/referentiel/magasins', { jeton: jetonGerant });
  const magSv = (magasins.donnees ?? []).find((m) => m.code === 'SV');
  const magBe = (magasins.donnees ?? []).find((m) => m.code === 'BE');
  verifier('Le gerant voit les deux magasins du groupe',
    magSv !== undefined && magBe !== undefined,
    (magasins.donnees ?? []).map((m) => m.code).join(', '));

  const depotSv = magSv.emplacements.find((e) => e.code === 'MC');
  const depotBe = magBe.emplacements.find((e) => e.code === 'MC');

  const etatDe = async (articleId) =>
    (await appel(`/stocks/article/${articleId}`, { jeton: jetonGerant })).donnees.emplacements;
  const quantiteA = (emplacements, codeMagasin, codeEmplacement) =>
    emplacements.find(
      (e) => e.code === codeEmplacement && e.magasin?.code === codeMagasin,
    )?.quantiteMilli ?? 0;

  const avant = await etatDe(huile.id);
  const totalAvant = avant.reduce((t, e) => t + e.quantiteMilli, 0);
  const depotSvAvant = quantiteA(avant, 'SV', 'MC');

  // Deux refus de bon sens avant le cas nominal.
  const memeMagasin = await appel('/transferts', {
    methode: 'POST', jeton: jetonGerant,
    corps: {
      magasinSourceId: magSv.id, magasinDestinationId: magSv.id,
      emplacementSourceId: depotSv.id,
      emplacementDestinationId: magSv.emplacements.find((e) => e.code === 'SV').id,
      lignes: [{ articleId: huile.id, quantiteMilli: 1000 }],
    },
  });
  verifier('Un transfert vers le meme magasin est refuse, avec l\'alternative',
    memeMagasin.statut === 400
      && String(memeMagasin.donnees?.message ?? '').includes('emplacements'),
    String(memeMagasin.donnees?.message ?? '').slice(0, 70));

  const articleDouble = await appel('/transferts', {
    methode: 'POST', jeton: jetonGerant,
    corps: {
      magasinSourceId: magSv.id, magasinDestinationId: magBe.id,
      emplacementSourceId: depotSv.id, emplacementDestinationId: depotBe.id,
      lignes: [
        { articleId: huile.id, quantiteMilli: 1000 },
        { articleId: huile.id, quantiteMilli: 2000 },
      ],
    },
  });
  verifier('Un article deux fois sur le meme bon est refuse',
    articleDouble.statut === 400,
    String(articleDouble.donnees?.message ?? '').slice(0, 70));

  const bonCroise = await appel('/transferts', {
    methode: 'POST', jeton: jetonGerant,
    corps: {
      magasinSourceId: magSv.id, magasinDestinationId: magBe.id,
      emplacementSourceId: depotBe.id, emplacementDestinationId: depotBe.id,
      lignes: [{ articleId: huile.id, quantiteMilli: 1000 }],
    },
  });
  verifier('Un emplacement de depart hors du magasin expediteur est refuse',
    bonCroise.statut === 400,
    String(bonCroise.donnees?.message ?? '').slice(0, 70));

  // Cas nominal : 10 bidons partent, 9 arrivent.
  const bon = await appel('/transferts', {
    methode: 'POST', jeton: jetonGerant,
    corps: {
      magasinSourceId: magSv.id, magasinDestinationId: magBe.id,
      emplacementSourceId: depotSv.id, emplacementDestinationId: depotBe.id,
      motif: 'Reapprovisionnement Bab Ezzouar',
      lignes: [{ articleId: huile.id, quantiteMilli: 10000 }],
    },
  });
  verifier('Un bon d\'expedition se prepare',
    bon.donnees?.statut === 'PREPARE' && typeof bon.donnees?.numero === 'string',
    bon.donnees?.numero ?? JSON.stringify(bon.donnees)?.slice(0, 80));

  const pendantPreparation = await etatDe(huile.id);
  verifier('Preparer un bon ne deplace rien',
    quantiteA(pendantPreparation, 'SV', 'MC') === depotSvAvant);

  const expedition = await appel(`/transferts/${bon.donnees.id}/expedition`, {
    methode: 'POST', jeton: jetonGerant,
  });
  verifier('Le bon s\'expedie', expedition.donnees?.statut === 'EXPEDIE',
    expedition.donnees?.statut ?? JSON.stringify(expedition.donnees)?.slice(0, 80));

  const enRoute = await etatDe(huile.id);
  verifier('Le depot expediteur est debite',
    quantiteA(enRoute, 'SV', 'MC') === depotSvAvant - 10000,
    `${depotSvAvant / 1000} -> ${quantiteA(enRoute, 'SV', 'MC') / 1000}`);
  verifier('La marchandise est en transit chez l\'expediteur, pas chez le destinataire',
    quantiteA(enRoute, 'SV', 'TR') === 10000 && quantiteA(enRoute, 'BE', 'MC') === 0,
    `transit ${quantiteA(enRoute, 'SV', 'TR') / 1000}, arrivee ${quantiteA(enRoute, 'BE', 'MC') / 1000}`);
  verifier('Rien ne se perd pendant le trajet',
    enRoute.reduce((t, e) => t + e.quantiteMilli, 0) === totalAvant,
    `${enRoute.reduce((t, e) => t + e.quantiteMilli, 0) / 1000} contre ${totalAvant / 1000}`);

  const transitAvantReception = await appel('/transferts/en-transit', { jeton: jetonGerant });
  verifier('Le rapport « en transit » montre la marchandise sur la route',
    (transitAvantReception.donnees ?? []).some((t) => t.numero === bon.donnees.numero),
    `${transitAvantReception.donnees?.length ?? 0} bon(s)`);

  const doubleExpedition = await appel(`/transferts/${bon.donnees.id}/expedition`, {
    methode: 'POST', jeton: jetonGerant,
  });
  verifier('Un bon deja expedie ne part pas une seconde fois',
    doubleExpedition.statut === 400,
    String(doubleExpedition.donnees?.message ?? '').slice(0, 60));

  const reception = await appel(`/transferts/${bon.donnees.id}/reception`, {
    methode: 'POST', jeton: jetonGerant,
    corps: {
      lignes: [{
        articleId: huile.id, quantiteRecueMilli: 9000,
        motifEcart: 'Un bidon casse sur le trajet',
      }],
      commentaire: 'Palette ouverte a l\'arrivee',
    },
  });
  verifier('Le bon de reception se signe et porte son propre numero',
    reception.donnees?.statut === 'RECU'
      && typeof reception.donnees?.numeroReception === 'string',
    reception.donnees?.numeroReception ?? JSON.stringify(reception.donnees)?.slice(0, 100));
  verifier('L\'ecart est signale sur le bon', reception.donnees?.avecEcart === true);
  verifier('L\'ecart est valorise au cout du depart',
    reception.donnees?.valeurEcartCentimes
      === -Math.round((1000 * reception.donnees.lignes[0].cumpCentimes) / 1000),
    `${reception.donnees?.valeurEcartCentimes} centimes`);
  verifier('Le motif de l\'ecart est conserve',
    reception.donnees?.lignes?.[0]?.motifEcart === 'Un bidon casse sur le trajet');

  const apresReception = await etatDe(huile.id);
  verifier('Le destinataire recoit ce qui a ete compte, pas ce qui etait annonce',
    quantiteA(apresReception, 'BE', 'MC') === 9000,
    `${quantiteA(apresReception, 'BE', 'MC') / 1000} recu(s) pour 10 annonces`);
  verifier('Le transit retombe a zero : plus rien sur la route',
    quantiteA(apresReception, 'SV', 'TR') === 0,
    `${quantiteA(apresReception, 'SV', 'TR') / 1000}`);

  // La verification qui compte : le groupe ne doit avoir perdu que le
  // bidon casse. C'est ce controle, et lui seul, qui revele un double
  // decompte du manquant.
  const totalApres = apresReception.reduce((t, e) => t + e.quantiteMilli, 0);
  verifier('Le groupe a perdu exactement la quantite manquante, ni plus ni moins',
    totalApres === totalAvant - 1000,
    `${totalApres / 1000} contre ${(totalAvant - 1000) / 1000} attendus`);

  const dejaRecu = await appel(`/transferts/${bon.donnees.id}/annulation`, {
    methode: 'POST', jeton: jetonGerant, corps: { motif: 'Essai' },
  });
  verifier('Un bon deja receptionne ne s\'annule pas',
    dejaRecu.statut === 400
      && String(dejaRecu.donnees?.message ?? '').includes('sens inverse'),
    String(dejaRecu.donnees?.message ?? '').slice(0, 70));

  // Annulation d'un bon deja expedie : la marchandise revient au depart.
  const bonRetour = await appel('/transferts', {
    methode: 'POST', jeton: jetonGerant,
    corps: {
      magasinSourceId: magSv.id, magasinDestinationId: magBe.id,
      emplacementSourceId: depotSv.id, emplacementDestinationId: depotBe.id,
      lignes: [{ articleId: huile.id, quantiteMilli: 2000 }],
    },
  });
  await appel(`/transferts/${bonRetour.donnees.id}/expedition`, {
    methode: 'POST', jeton: jetonGerant,
  });
  const avantDemiTour = quantiteA(await etatDe(huile.id), 'SV', 'MC');
  const demiTour = await appel(`/transferts/${bonRetour.donnees.id}/annulation`, {
    methode: 'POST', jeton: jetonGerant, corps: { motif: 'Le camion a fait demi-tour' },
  });
  verifier('Un bon expedie s\'annule', demiTour.donnees?.statut === 'ANNULE');
  const apresDemiTour = await etatDe(huile.id);
  verifier('La marchandise revient au depot de depart',
    quantiteA(apresDemiTour, 'SV', 'MC') === avantDemiTour + 2000,
    `${avantDemiTour / 1000} -> ${quantiteA(apresDemiTour, 'SV', 'MC') / 1000}`);
  verifier('Et le transit est vide',
    quantiteA(apresDemiTour, 'SV', 'TR') === 0);
  verifier('L\'annulation ne fait ni perdre ni creer de marchandise',
    apresDemiTour.reduce((t, e) => t + e.quantiteMilli, 0) === totalApres);

  const vuCaissier = await appel('/transferts', { jeton: jetonCaissier });
  verifier('Un caissier ne gere pas les transferts',
    vuCaissier.statut === 403, `statut ${vuCaissier.statut}`);

  titre('15. Consolidation du groupe (M11)');

  const consolide = await appel(`/rapports/consolidation?${surLeMois}`, { jeton: jetonGerant });
  verifier('La consolidation repond', consolide.statut === 200);
  verifier('Elle couvre les deux magasins',
    (consolide.donnees?.magasins ?? []).length === 2,
    (consolide.donnees?.magasins ?? []).map((m) => m.code).join(', '));

  const sommeCa = (consolide.donnees?.magasins ?? [])
    .reduce((t, m) => t + Number(m.chiffreAffairesTtcCentimes), 0);
  verifier('Le chiffre d\'affaires du groupe est la somme des magasins',
    sommeCa === Number(consolide.donnees?.groupe?.chiffreAffairesTtcCentimes),
    `${sommeCa} contre ${consolide.donnees?.groupe?.chiffreAffairesTtcCentimes}`);

  // La synthese et la consolidation doivent donner le meme total : deux
  // chiffres differents pour la meme periode ruineraient la confiance.
  verifier('Elle s\'accorde avec la synthese de periode',
    Number(consolide.donnees?.groupe?.chiffreAffairesTtcCentimes)
      === Number(synthese.donnees?.chiffreAffairesTtcCentimes),
    `${consolide.donnees?.groupe?.chiffreAffairesTtcCentimes} contre ${synthese.donnees?.chiffreAffairesTtcCentimes}`);

  const magasinBe = (consolide.donnees?.magasins ?? []).find((m) => m.code === 'BE');
  verifier('Le magasin qui a recu la marchandise porte sa valeur en stock',
    Number(magasinBe?.valeurStockCentimes) > 0,
    `${magasinBe?.valeurStockCentimes} centimes`);
  verifier('Plus rien n\'est en transit apres les receptions',
    Number(consolide.donnees?.groupe?.valeurEnTransitCentimes) === 0,
    `${consolide.donnees?.groupe?.valeurEnTransitCentimes}`);

  verifier('La tresorerie du siege est comptee a part, pas imputee a un magasin',
    consolide.donnees?.siege !== null
      && Number(consolide.donnees?.siege?.nombreComptes) >= 1,
    JSON.stringify(consolide.donnees?.siege));

  const tresorerieMagasins = (consolide.donnees?.magasins ?? [])
    .reduce((t, m) => t + Number(m.tresorerieCentimes), 0);
  verifier('La tresorerie du groupe comprend les magasins et le siege',
    Number(consolide.donnees?.groupe?.tresorerieCentimes)
      === tresorerieMagasins + Number(consolide.donnees?.siege?.tresorerieCentimes ?? 0),
    `${consolide.donnees?.groupe?.tresorerieCentimes}`);

  // La synthese doit desormais porter l'axe « magasin » de la section 9.
  verifier('La synthese porte l\'axe « par magasin »',
    Array.isArray(synthese.donnees?.parMagasin) && synthese.donnees.parMagasin.length > 0,
    JSON.stringify(synthese.donnees?.parMagasin?.[0] ?? null)?.slice(0, 80));

  for (const format of ['xlsx', 'pdf']) {
    for (const nom of ['consolidation', 'en-transit']) {
      const reponse = await fetch(
        `${BASE}/rapports/${nom}/export.${format}?${surLeMois}`,
        { headers: { Authorization: `Bearer ${jetonGerant}` } },
      );
      const octets = Buffer.from(await reponse.arrayBuffer());
      const signature = format === 'xlsx'
        ? octets.subarray(0, 2).toString() === 'PK'
        : octets.subarray(0, 5).toString() === '%PDF-';
      verifier(`${nom}.${format} est un fichier ${format} valide`,
        reponse.status === 200 && signature && octets.length > 500,
        `${reponse.status}, ${octets.length} octets`);
    }
  }

  titre('16. Journal d\'audit');

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
