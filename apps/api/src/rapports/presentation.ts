import { formaterDA, libelleModePaiement } from '@gestglobale/shared';
import { formaterJour, type Rapport } from './tableau';

/**
 * Mise en forme des rapports (M9).
 *
 * Un seul endroit decrit, pour chaque rapport, son titre, ses colonnes
 * et ses totaux. L'ecran, l'Excel et le PDF en decoulent, donc ils ne
 * peuvent pas se contredire.
 */

const DA = (centimes: number) => formaterDA(centimes, { devise: true });

function periodeEnTexte(p: { debut: Date | string; fin: Date | string }): string {
  const debut = new Date(p.debut);
  // La borne de fin est exclusive dans les requetes ; a l'affichage on
  // montre le dernier jour inclus, sinon un rapport de janvier annonce
  // le 1er fevrier.
  const fin = new Date(new Date(p.fin).getTime() - 1);
  return `Du ${formaterJour(debut)} au ${formaterJour(fin)}`;
}

/* ------------------------------------------------------------------ */

export function synthesePeriode(donnees: {
  periode: { debut: Date; fin: Date };
  nombreTickets: number;
  nombreAnnulations: number;
  chiffreAffairesTtcCentimes: number;
  chiffreAffairesHtCentimes: number;
  margeCentimes: number;
  panierMoyenCentimes: number;
  parJour: Array<Record<string, unknown>>;
  parHeure: Array<Record<string, unknown>>;
  parCaisse: Array<Record<string, unknown>>;
  parCaissier: Array<Record<string, unknown>>;
  parFamille: Array<Record<string, unknown>>;
  parMagasin: Array<Record<string, unknown>>;
  parModePaiement: Array<Record<string, unknown>>;
}): Rapport {
  const tauxMarge = donnees.chiffreAffairesHtCentimes > 0
    ? (donnees.margeCentimes / donnees.chiffreAffairesHtCentimes) * 100
    : 0;

  return {
    titre: 'Synthese des ventes',
    sousTitre: periodeEnTexte(donnees.periode),
    enTete: [
      { intitule: 'Chiffre d’affaires TTC', valeur: DA(donnees.chiffreAffairesTtcCentimes) },
      {
        intitule: 'Marge',
        valeur: `${DA(donnees.margeCentimes)} (${tauxMarge.toFixed(1).replace('.', ',')} %)`,
      },
      { intitule: 'Tickets', valeur: String(donnees.nombreTickets) },
      { intitule: 'Panier moyen', valeur: DA(donnees.panierMoyenCentimes) },
    ],
    blocs: [
      {
        titre: 'Par jour',
        colonnes: [
          { cle: 'jour', titre: 'Jour', sorte: 'date', largeur: 14 },
          { cle: 'nombreTickets', titre: 'Tickets', sorte: 'nombre', largeur: 10 },
          { cle: 'chiffreAffairesCentimes', titre: 'CA TTC', sorte: 'montant', largeur: 16 },
        ],
        lignes: donnees.parJour,
        total: {
          jour: 'Total',
          nombreTickets: donnees.nombreTickets,
          chiffreAffairesCentimes: donnees.chiffreAffairesTtcCentimes,
        },
        siVide: 'Aucune vente sur la periode.',
      },
      {
        titre: 'Par heure',
        colonnes: [
          { cle: 'heure', titre: 'Heure', largeur: 10 },
          { cle: 'nombreTickets', titre: 'Tickets', sorte: 'nombre', largeur: 10 },
          { cle: 'chiffreAffairesCentimes', titre: 'CA TTC', sorte: 'montant', largeur: 16 },
          { cle: 'margeCentimes', titre: 'Marge', sorte: 'montant', largeur: 16 },
        ],
        lignes: donnees.parHeure.map((h) => ({ ...h, heure: `${h.heure}h` })),
      },
      {
        titre: 'Par caisse',
        colonnes: [
          { cle: 'numeroCaisse', titre: 'Caisse', largeur: 10 },
          { cle: 'nombreTickets', titre: 'Tickets', sorte: 'nombre', largeur: 10 },
          { cle: 'chiffreAffairesCentimes', titre: 'CA TTC', sorte: 'montant', largeur: 16 },
          { cle: 'margeCentimes', titre: 'Marge', sorte: 'montant', largeur: 16 },
        ],
        lignes: donnees.parCaisse,
      },
      {
        titre: 'Par magasin',
        colonnes: [
          { cle: 'code', titre: 'Code', largeur: 8 },
          { cle: 'nom', titre: 'Magasin', largeur: 26 },
          { cle: 'nombreTickets', titre: 'Tickets', sorte: 'nombre', largeur: 10 },
          { cle: 'chiffreAffairesCentimes', titre: 'CA TTC', sorte: 'montant', largeur: 16 },
          { cle: 'margeCentimes', titre: 'Marge', sorte: 'montant', largeur: 16 },
        ],
        lignes: donnees.parMagasin,
      },
      {
        titre: 'Par caissier',
        colonnes: [
          { cle: 'code', titre: 'Code', largeur: 8 },
          { cle: 'nom', titre: 'Caissier', largeur: 26 },
          { cle: 'nombreTickets', titre: 'Tickets', sorte: 'nombre', largeur: 10 },
          { cle: 'chiffreAffairesCentimes', titre: 'CA TTC', sorte: 'montant', largeur: 16 },
        ],
        lignes: donnees.parCaissier,
      },
      {
        titre: 'Par rayon et famille',
        colonnes: [
          { cle: 'rayon', titre: 'Rayon', largeur: 20 },
          { cle: 'famille', titre: 'Famille', largeur: 24 },
          { cle: 'quantiteMilli', titre: 'Quantite', sorte: 'quantite', largeur: 12 },
          { cle: 'chiffreAffairesCentimes', titre: 'CA TTC', sorte: 'montant', largeur: 16 },
          { cle: 'margeCentimes', titre: 'Marge', sorte: 'montant', largeur: 16 },
        ],
        lignes: donnees.parFamille,
      },
      {
        titre: 'Par mode de reglement',
        colonnes: [
          { cle: 'mode', titre: 'Mode', largeur: 20 },
          { cle: 'montantCentimes', titre: 'Montant', sorte: 'montant', largeur: 18 },
        ],
        lignes: donnees.parModePaiement.map((m) => ({
          ...m, mode: libelleModePaiement(String(m.mode)),
        })),
      },
    ],
    note:
      `${donnees.nombreAnnulations} ticket(s) annule(s) sur la periode ; ils ne sont `
      + 'comptes ni dans le chiffre d’affaires ni dans les tickets. La marge est '
      + 'figee ligne par ligne au CUMP du moment de la vente : elle dit ce qui s’est '
      + 'passe, pas ce que donnerait le CUMP d’aujourd’hui.',
  };
}

export function palmaresProduits(
  sens: 'TOP' | 'FLOP',
  periode: { debut: Date; fin: Date },
  lignes: Array<Record<string, unknown>>,
): Rapport {
  return {
    titre: sens === 'TOP' ? 'Meilleures ventes' : 'Produits les moins rentables',
    sousTitre: periodeEnTexte(periode),
    blocs: [{
      colonnes: [
        { cle: 'reference', titre: 'Reference', largeur: 14 },
        { cle: 'designation', titre: 'Designation', largeur: 38 },
        { cle: 'quantiteMilli', titre: 'Quantite', sorte: 'quantite', largeur: 12 },
        { cle: 'chiffreAffairesCentimes', titre: 'CA TTC', sorte: 'montant', largeur: 16 },
        { cle: 'margeCentimes', titre: 'Marge', sorte: 'montant', largeur: 16 },
        { cle: 'venteAPerte', titre: 'A perte', sorte: 'booleen', largeur: 9 },
      ],
      lignes,
    }],
    note: sens === 'FLOP'
      ? 'Classement par marge croissante. Un produit en tete de cette liste n’est pas '
        + 'forcement a retirer : une promotion d’appel y figure legitimement.'
      : undefined,
  };
}

export function produitsDormants(
  jours: number,
  lignes: Array<Record<string, unknown>>,
): Rapport {
  const valeur = lignes.reduce(
    (t, l) => t + Number(l.valeurImmobiliseeCentimes ?? 0), 0,
  );
  return {
    titre: 'Produits dormants',
    sousTitre: `Aucune vente depuis ${jours} jours, stock encore present`,
    enTete: [
      { intitule: 'References concernees', valeur: String(lignes.length) },
      { intitule: 'Argent immobilise', valeur: DA(valeur) },
    ],
    blocs: [{
      colonnes: [
        { cle: 'reference', titre: 'Reference', largeur: 14 },
        { cle: 'designation', titre: 'Designation', largeur: 44 },
        { cle: 'stockMilli', titre: 'Stock', sorte: 'quantite', largeur: 12 },
        { cle: 'valeurImmobiliseeCentimes', titre: 'Valeur au CUMP', sorte: 'montant', largeur: 18 },
      ],
      lignes,
      total: { reference: 'Total', valeurImmobiliseeCentimes: valeur },
      siVide: 'Tout le stock a tourne sur la periode.',
    }],
  };
}

export function ruptures(lignes: Array<Record<string, unknown>>): Rapport {
  const enRupture = lignes.filter((l) => l.rupture === true).length;
  return {
    titre: 'Ruptures et seuils de reassort',
    sousTitre: 'Articles vendables dont le stock est epuise ou sous son seuil',
    enTete: [
      { intitule: 'En rupture', valeur: String(enRupture) },
      { intitule: 'Sous le seuil', valeur: String(lignes.length - enRupture) },
    ],
    blocs: [{
      colonnes: [
        { cle: 'reference', titre: 'Reference', largeur: 13 },
        { cle: 'designation', titre: 'Designation', largeur: 34 },
        { cle: 'emplacement', titre: 'Lieu', largeur: 8 },
        { cle: 'stockMilli', titre: 'Stock', sorte: 'quantite', largeur: 11 },
        { cle: 'seuilAlerteMilli', titre: 'Seuil', sorte: 'quantite', largeur: 11 },
        { cle: 'rupture', titre: 'Rupture', sorte: 'booleen', largeur: 9 },
        { cle: 'quantiteVendue30jMilli', titre: 'Vendu 30 j', sorte: 'quantite', largeur: 12 },
        { cle: 'derniereSortie', titre: 'Derniere sortie', sorte: 'date', largeur: 14 },
      ],
      lignes,
      siVide: 'Aucune rupture ni franchissement de seuil.',
    }],
    note:
      'Le tri met les ruptures en premier, puis les articles qui se vendent le plus. '
      + 'Un seuil a zero signifie qu’aucun seuil n’a ete defini pour cet article : '
      + 'il n’apparait alors ici qu’en rupture complete.',
  };
}

export function ventesAPerte(donnees: {
  periode: { debut: Date; fin: Date };
  nombreLignes: number;
  perteTotaleCentimes: number;
  articles: Array<Record<string, unknown>>;
}): Rapport {
  return {
    titre: 'Produits vendus a perte',
    sousTitre: periodeEnTexte(donnees.periode),
    enTete: [
      { intitule: 'Lignes concernees', valeur: String(donnees.nombreLignes) },
      { intitule: 'Perte cumulee', valeur: DA(donnees.perteTotaleCentimes) },
      { intitule: 'References', valeur: String(donnees.articles.length) },
    ],
    blocs: [{
      colonnes: [
        { cle: 'reference', titre: 'Reference', largeur: 13 },
        { cle: 'designation', titre: 'Designation', largeur: 34 },
        { cle: 'quantiteMilli', titre: 'Quantite', sorte: 'quantite', largeur: 11 },
        { cle: 'prixMoyenCentimes', titre: 'Prix moyen', sorte: 'montant', largeur: 14 },
        { cle: 'cumpMoyenCentimes', titre: 'CUMP moyen', sorte: 'montant', largeur: 14 },
        { cle: 'chiffreAffairesCentimes', titre: 'CA TTC', sorte: 'montant', largeur: 14 },
        { cle: 'perteCentimes', titre: 'Perte', sorte: 'montant', largeur: 14 },
        { cle: 'lignesEnPromotion', titre: 'Dont promo', sorte: 'nombre', largeur: 11 },
      ],
      lignes: donnees.articles,
      total: {
        reference: 'Total',
        perteCentimes: donnees.perteTotaleCentimes,
        lignesEnPromotion: donnees.articles.reduce(
          (t, a) => t + Number(a.lignesEnPromotion ?? 0), 0),
      },
      siVide: 'Aucun produit vendu sous son CUMP sur la periode.',
    }],
    note:
      'Vendre a perte n’est pas toujours une erreur : une promotion d’appel ou un '
      + 'produit proche de la peremption se vendent sciemment sous le CUMP. La colonne '
      + '« Dont promo » compte les lignes ou une promotion l’explique ; les autres '
      + 'meritent un coup d’œil sur le prix de vente.',
  };
}

export function ecartsDeCaisse(donnees: {
  depuis: Date; jours: number;
  parCaissier: Array<Record<string, unknown>>;
  clotures: Array<Record<string, unknown>>;
}): Rapport {
  const cumul = donnees.parCaissier.reduce(
    (t, p) => t + Number(p.ecartCumuleCentimes ?? 0), 0,
  );
  const nonJustifies = donnees.parCaissier.reduce(
    (t, p) => t + Number(p.nombreNonJustifies ?? 0), 0,
  );
  const cumulAbsolu = donnees.parCaissier.reduce(
    (t, p) => t + Number(p.ecartAbsoluCentimes ?? 0), 0,
  );
  const totalClotures = donnees.parCaissier.reduce(
    (t, p) => t + Number(p.nombreClotures ?? 0), 0,
  );
  return {
    titre: 'Ecarts de caisse',
    sousTitre: `Clotures Z des ${donnees.jours} derniers jours, depuis le ${formaterJour(donnees.depuis)}`,
    enTete: [
      { intitule: 'Ecart cumule', valeur: DA(cumul) },
      { intitule: 'Clotures', valeur: String(donnees.clotures.length) },
      { intitule: 'Ecarts non justifies', valeur: String(nonJustifies) },
    ],
    blocs: [
      {
        titre: 'Par caissier',
        colonnes: [
          { cle: 'code', titre: 'Code', largeur: 7 },
          { cle: 'nom', titre: 'Caissier', largeur: 24 },
          { cle: 'nombreClotures', titre: 'Clotures', sorte: 'nombre', largeur: 10 },
          { cle: 'ecartCumuleCentimes', titre: 'Ecart cumule', sorte: 'montant', largeur: 15 },
          { cle: 'ecartAbsoluCentimes', titre: 'Ecart absolu', sorte: 'montant', largeur: 15 },
          { cle: 'ecartMoyenCentimes', titre: 'Moyenne', sorte: 'montant', largeur: 13 },
          { cle: 'nombreManquants', titre: 'Manquants', sorte: 'nombre', largeur: 11 },
          { cle: 'nombreExcedents', titre: 'Excedents', sorte: 'nombre', largeur: 11 },
          { cle: 'nombreNonJustifies', titre: 'Non justifies', sorte: 'nombre', largeur: 12 },
        ],
        lignes: donnees.parCaissier,
        total: {
          code: 'Total',
          nombreClotures: totalClotures,
          ecartCumuleCentimes: cumul,
          ecartAbsoluCentimes: cumulAbsolu,
          nombreManquants: donnees.parCaissier.reduce(
            (t, p) => t + Number(p.nombreManquants ?? 0), 0),
          nombreExcedents: donnees.parCaissier.reduce(
            (t, p) => t + Number(p.nombreExcedents ?? 0), 0),
          nombreNonJustifies: nonJustifies,
        },
        siVide: 'Aucune cloture Z sur la periode.',
      },
      {
        titre: 'Detail des clotures',
        colonnes: [
          { cle: 'numero', titre: 'Cloture', largeur: 15 },
          { cle: 'clotureeLe', titre: 'Date', sorte: 'horodatage', largeur: 17 },
          { cle: 'numeroCaisse', titre: 'Caisse', largeur: 8 },
          { cle: 'caissierNom', titre: 'Caissier', largeur: 20 },
          { cle: 'theoriqueEspecesCentimes', titre: 'Theorique', sorte: 'montant', largeur: 14 },
          { cle: 'compteEspecesCentimes', titre: 'Compte', sorte: 'montant', largeur: 14 },
          { cle: 'ecartCentimes', titre: 'Ecart', sorte: 'montant', largeur: 13 },
          { cle: 'justification', titre: 'Justification', largeur: 34 },
          { cle: 'horsLigne', titre: 'Hors ligne', sorte: 'booleen', largeur: 10 },
        ],
        lignes: donnees.clotures,
      },
    ],
    note:
      'Un ecart n’accuse personne. Un total de ticket tombe sur n’importe quel '
      + 'centime alors que la plus petite coupure vaut 5 DA : une part de l’ecart est '
      + 'donc structurelle et ne peut pas etre comptee. Ce qui se lit ici, c’est la '
      + 'derive — un caissier toujours court dans le meme sens — et les ecarts restes '
      + 'sans explication.',
  };
}

export function annulationsEtRemises(donnees: {
  periode: { debut: Date; fin: Date };
  annulations: Array<Record<string, unknown>>;
  remises: Array<Record<string, unknown>>;
  remisesParCaissier: Array<Record<string, unknown>>;
}): Rapport {
  const totalAnnule = donnees.annulations.reduce(
    (t, a) => t + Number(a.totalTtcCentimes ?? 0), 0,
  );
  const totalRemises = donnees.remisesParCaissier.reduce(
    (t, r) => t + Number(r.totalRemiseCentimes ?? 0), 0,
  );
  const forcees = donnees.remisesParCaissier.reduce(
    (t, r) => t + Number(r.nombreForcees ?? 0), 0,
  );
  return {
    titre: 'Annulations et remises',
    sousTitre: periodeEnTexte(donnees.periode),
    enTete: [
      { intitule: 'Tickets annules', valeur: String(donnees.annulations.length) },
      { intitule: 'Montant annule', valeur: DA(totalAnnule) },
      { intitule: 'Remises accordees', valeur: DA(totalRemises) },
      { intitule: 'Dont forcees par un responsable', valeur: String(forcees) },
    ],
    blocs: [
      {
        titre: 'Remises par caissier',
        colonnes: [
          { cle: 'code', titre: 'Code', largeur: 8 },
          { cle: 'nom', titre: 'Caissier', largeur: 28 },
          { cle: 'nombreRemises', titre: 'Remises', sorte: 'nombre', largeur: 11 },
          { cle: 'totalRemiseCentimes', titre: 'Total accorde', sorte: 'montant', largeur: 17 },
          { cle: 'nombreForcees', titre: 'Dont forcees', sorte: 'nombre', largeur: 13 },
        ],
        lignes: donnees.remisesParCaissier,
        total: {
          code: 'Total',
          nombreRemises: donnees.remisesParCaissier.reduce(
            (t, r) => t + Number(r.nombreRemises ?? 0), 0),
          totalRemiseCentimes: totalRemises,
          nombreForcees: forcees,
        },
        siVide: 'Aucune remise accordee sur la periode.',
      },
      {
        titre: 'Tickets annules',
        colonnes: [
          { cle: 'numero', titre: 'Ticket', largeur: 16 },
          { cle: 'dateVente', titre: 'Date', sorte: 'horodatage', largeur: 17 },
          { cle: 'numeroCaisse', titre: 'Caisse', largeur: 8 },
          { cle: 'caissierNom', titre: 'Caissier', largeur: 24 },
          { cle: 'nombreLignes', titre: 'Lignes', sorte: 'nombre', largeur: 9 },
          { cle: 'totalTtcCentimes', titre: 'Montant', sorte: 'montant', largeur: 16 },
        ],
        lignes: donnees.annulations,
        total: {
          numero: 'Total',
          nombreLignes: donnees.annulations.reduce(
            (t, a) => t + Number(a.nombreLignes ?? 0), 0),
          totalTtcCentimes: totalAnnule,
        },
        siVide: 'Aucun ticket annule sur la periode.',
      },
      {
        titre: 'Remises ligne par ligne',
        colonnes: [
          { cle: 'numero', titre: 'Ticket', largeur: 15 },
          { cle: 'dateVente', titre: 'Date', sorte: 'horodatage', largeur: 16 },
          { cle: 'caissierNom', titre: 'Caissier', largeur: 18 },
          { cle: 'reference', titre: 'Reference', largeur: 12 },
          { cle: 'designation', titre: 'Article', largeur: 26 },
          { cle: 'prixUnitaireCentimes', titre: 'Prix', sorte: 'montant', largeur: 12 },
          { cle: 'remisePourcent', titre: 'Taux', sorte: 'pourcent', largeur: 9 },
          { cle: 'remiseCentimes', titre: 'Remise', sorte: 'montant', largeur: 13 },
          { cle: 'autoriseeParNom', titre: 'Autorisee par', largeur: 18 },
        ],
        lignes: donnees.remises,
      },
    ],
    note:
      'Annuler un ticket et remiser une ligne sont les deux gestes par lesquels de '
      + 'l’argent sort sans marchandise. La colonne « Autorisee par » nomme le '
      + 'responsable qui a leve le plafond du caissier ; vide, la remise etait dans '
      + 'son plafond.',
  };
}

export function consolidation(donnees: {
  periode: { debut: Date; fin: Date };
  magasins: Array<Record<string, unknown>>;
  siege: { tresorerieCentimes: number; nombreComptes: number } | null;
  groupe: Record<string, number>;
}): Rapport {
  const g = donnees.groupe;
  return {
    titre: 'Consolidation du groupe',
    sousTitre: periodeEnTexte(donnees.periode),
    enTete: [
      { intitule: 'Magasins', valeur: String(g.nombreMagasins) },
      { intitule: 'Chiffre d’affaires TTC', valeur: DA(g.chiffreAffairesTtcCentimes) },
      { intitule: 'Marge', valeur: DA(g.margeCentimes) },
      { intitule: 'Panier moyen', valeur: DA(g.panierMoyenCentimes) },
      { intitule: 'Valeur du stock', valeur: DA(g.valeurStockCentimes) },
      { intitule: 'Dont en transit', valeur: DA(g.valeurEnTransitCentimes) },
      { intitule: 'Tresorerie', valeur: DA(g.tresorerieCentimes) },
      { intitule: 'Ruptures', valeur: String(g.nombreRuptures) },
    ],
    blocs: [{
      titre: 'Magasin par magasin',
      colonnes: [
        { cle: 'code', titre: 'Code', largeur: 7 },
        { cle: 'nom', titre: 'Magasin', largeur: 22 },
        { cle: 'nombreTickets', titre: 'Tickets', sorte: 'nombre', largeur: 9 },
        { cle: 'chiffreAffairesTtcCentimes', titre: 'CA TTC', sorte: 'montant', largeur: 15 },
        { cle: 'margeCentimes', titre: 'Marge', sorte: 'montant', largeur: 14 },
        { cle: 'panierMoyenCentimes', titre: 'Panier moyen', sorte: 'montant', largeur: 14 },
        { cle: 'valeurStockCentimes', titre: 'Stock', sorte: 'montant', largeur: 15 },
        { cle: 'valeurEnTransitCentimes', titre: 'En transit', sorte: 'montant', largeur: 13 },
        { cle: 'tresorerieCentimes', titre: 'Tresorerie', sorte: 'montant', largeur: 14 },
        { cle: 'nombreRuptures', titre: 'Ruptures', sorte: 'nombre', largeur: 10 },
      ],
      lignes: donnees.magasins,
      total: {
        code: 'Groupe',
        nombreTickets: g.nombreTickets,
        chiffreAffairesTtcCentimes: g.chiffreAffairesTtcCentimes,
        margeCentimes: g.margeCentimes,
        panierMoyenCentimes: g.panierMoyenCentimes,
        valeurStockCentimes: g.valeurStockCentimes,
        valeurEnTransitCentimes: g.valeurEnTransitCentimes,
        tresorerieCentimes: g.tresorerieCentimes,
        nombreRuptures: g.nombreRuptures,
      },
      siVide: 'Aucun magasin dans votre perimetre.',
    }],
    note:
      'La tresorerie du groupe comprend les comptes du siege, qui n’appartiennent a '
      + 'aucun magasin'
      + (donnees.siege ? ` (${DA(donnees.siege.tresorerieCentimes)})` : '')
      + '. La colonne « En transit » est de la marchandise partie d’un magasin et pas '
      + 'encore recue dans l’autre : elle appartient encore a l’expediteur, mais '
      + 'elle n’est dans aucun rayon et ne peut pas etre vendue.',
  };
}

export function transfertsEnTransit(lignes: Array<Record<string, unknown>>): Rapport {
  const valeur = lignes.reduce(
    (t, l) => t + Number(l.valeurExpedieeCentimes ?? 0), 0,
  );
  return {
    titre: 'Marchandise en transit',
    sousTitre: 'Bons expedies et pas encore receptionnes',
    enTete: [
      { intitule: 'Transferts en cours', valeur: String(lignes.length) },
      { intitule: 'Valeur sur la route', valeur: DA(valeur) },
    ],
    blocs: [{
      colonnes: [
        { cle: 'numero', titre: 'Bon', largeur: 16 },
        { cle: 'expedieLe', titre: 'Expedie le', sorte: 'date', largeur: 13 },
        { cle: 'joursEnTransit', titre: 'Jours', sorte: 'nombre', largeur: 8 },
        { cle: 'sourceNom', titre: 'De', largeur: 22 },
        { cle: 'destinationNom', titre: 'Vers', largeur: 22 },
        { cle: 'nombreLignes', titre: 'Lignes', sorte: 'nombre', largeur: 9 },
        { cle: 'valeurExpedieeCentimes', titre: 'Valeur', sorte: 'montant', largeur: 16 },
      ],
      lignes: lignes.map((l: any) => ({
        ...l,
        sourceNom: l.magasinSource?.nom ?? '',
        destinationNom: l.magasinDestination?.nom ?? '',
        nombreLignes: l.lignes?.length ?? 0,
      })),
      total: { numero: 'Total', valeurExpedieeCentimes: valeur },
      siVide: 'Rien sur la route : tous les bons expedies ont ete receptionnes.',
    }],
    note:
      'Un bon expedie depuis plusieurs jours et jamais receptionne merite un appel : '
      + 'soit la marchandise n’est pas arrivee, soit personne n’a signe le bon de '
      + 'reception. Dans les deux cas, le stock des deux magasins est faux tant que ce '
      + 'n’est pas regle.',
  };
}
