import { formaterDA, libelleModePaiement } from '@gestglobale/shared';
import { formaterJour, type Rapport } from '../rapports/tableau';

/**
 * Mise en forme des journaux comptables (M12).
 *
 * Comme pour les rapports du gerant, une seule description par journal
 * sert l'ecran, le CSV, l'Excel et le PDF : un export qui s'ecarterait
 * de l'ecran serait pire qu'une absence d'export, parce que le
 * comptable ne saurait plus lequel croire.
 */

const DA = (centimes: number) => formaterDA(centimes, { devise: true });

function periodeEnTexte(p: { debut: Date | string; fin: Date | string }): string {
  const debut = new Date(p.debut);
  const fin = new Date(new Date(p.fin).getTime() - 1);
  return `Du ${formaterJour(debut)} au ${formaterJour(fin)}`;
}

/** Colonnes de ventilation, une paire par taux rencontre. */
function colonnesParTaux(taux: number[]) {
  return taux.flatMap((t) => ([
    { cle: `ht${t}`, titre: `Base ${t} %`, sorte: 'montant' as const, largeur: 14 },
    { cle: `tva${t}`, titre: `TVA ${t} %`, sorte: 'montant' as const, largeur: 13 },
  ]));
}

export function journalVentes(donnees: {
  periode: { debut: Date; fin: Date };
  lignes: Array<Record<string, any>>;
  totaux: Record<string, any>;
  nombreAnnulations: number;
}): Rapport {
  // Un taux n'ouvre une colonne que s'il apparait reellement : un
  // journal a TVA nulle n'a aucune raison d'afficher six colonnes vides.
  const taux = [...new Set(
    donnees.lignes.flatMap((l) => l.ventilation.map((v: any) => v.taux)),
  )].sort((a, b) => a - b);

  const aplatir = (ligne: Record<string, any>) => {
    const plat: Record<string, unknown> = { ...ligne };
    for (const t of taux) {
      const v = ligne.ventilation?.find((x: any) => x.taux === t);
      plat[`ht${t}`] = v?.htCentimes ?? null;
      plat[`tva${t}`] = v?.tvaCentimes ?? null;
    }
    return plat;
  };

  const total: Record<string, unknown> = {
    numero: 'Total',
    totalHtCentimes: donnees.totaux.totalHtCentimes,
    totalTvaCentimes: donnees.totaux.totalTvaCentimes,
    timbreCentimes: donnees.totaux.timbreCentimes,
    totalTtcCentimes: donnees.totaux.totalTtcCentimes,
  };
  for (const t of taux) {
    const v = donnees.totaux.parTaux.find((x: any) => x.taux === t);
    total[`ht${t}`] = v?.htCentimes ?? null;
    total[`tva${t}`] = v?.tvaCentimes ?? null;
  }

  return {
    titre: 'Journal des ventes',
    sousTitre: periodeEnTexte(donnees.periode),
    enTete: [
      { intitule: 'Pieces', valeur: String(donnees.totaux.nombrePieces) },
      { intitule: 'Total HT', valeur: DA(donnees.totaux.totalHtCentimes) },
      { intitule: 'TVA', valeur: DA(donnees.totaux.totalTvaCentimes) },
      { intitule: 'Total TTC', valeur: DA(donnees.totaux.totalTtcCentimes) },
    ],
    blocs: [{
      colonnes: [
        { cle: 'date', titre: 'Date', sorte: 'date', largeur: 12 },
        { cle: 'magasin', titre: 'Mag.', largeur: 7 },
        { cle: 'numero', titre: 'Piece', largeur: 16 },
        { cle: 'type', titre: 'Type', largeur: 13 },
        { cle: 'clientNom', titre: 'Client', largeur: 24 },
        { cle: 'clientNif', titre: 'NIF', largeur: 16 },
        ...colonnesParTaux(taux),
        { cle: 'totalHtCentimes', titre: 'Total HT', sorte: 'montant', largeur: 14 },
        { cle: 'totalTvaCentimes', titre: 'Total TVA', sorte: 'montant', largeur: 13 },
        { cle: 'timbreCentimes', titre: 'Timbre', sorte: 'montant', largeur: 11 },
        { cle: 'totalTtcCentimes', titre: 'Total TTC', sorte: 'montant', largeur: 15 },
        { cle: 'reglements', titre: 'Reglement', largeur: 26 },
        { cle: 'statut', titre: 'Statut', largeur: 10 },
      ],
      lignes: donnees.lignes.map(aplatir),
      total,
      siVide: 'Aucune vente sur la periode.',
    }],
    note:
      `${donnees.nombreAnnulations} piece(s) annulee(s) figurent au journal avec leur `
      + 'statut, et ne sont pas comptees dans les totaux. Les y laisser est voulu : '
      + 'effacer une piece annulee laisserait un trou dans la numerotation que personne '
      + 'ne pourrait expliquer.',
  };
}

export function journalAchats(donnees: {
  periode: { debut: Date; fin: Date };
  lignes: Array<Record<string, unknown>>;
  totaux: Record<string, number>;
}): Rapport {
  return {
    titre: 'Journal des achats',
    sousTitre: periodeEnTexte(donnees.periode),
    enTete: [
      { intitule: 'Factures', valeur: String(donnees.totaux.nombrePieces) },
      { intitule: 'Total HT', valeur: DA(donnees.totaux.totalHtCentimes) },
      { intitule: 'TVA deductible', valeur: DA(donnees.totaux.totalTvaCentimes) },
      { intitule: 'Reste du', valeur: DA(donnees.totaux.resteDuCentimes) },
    ],
    blocs: [{
      colonnes: [
        { cle: 'date', titre: 'Date', sorte: 'date', largeur: 12 },
        { cle: 'magasin', titre: 'Mag.', largeur: 7 },
        { cle: 'numero', titre: 'Piece', largeur: 15 },
        { cle: 'numeroFournisseur', titre: 'N° fournisseur', largeur: 15 },
        { cle: 'fournisseurNom', titre: 'Fournisseur', largeur: 24 },
        { cle: 'fournisseurNif', titre: 'NIF', largeur: 16 },
        { cle: 'totalHtCentimes', titre: 'Total HT', sorte: 'montant', largeur: 14 },
        { cle: 'totalTvaCentimes', titre: 'TVA', sorte: 'montant', largeur: 13 },
        { cle: 'timbreCentimes', titre: 'Timbre', sorte: 'montant', largeur: 11 },
        { cle: 'totalTtcCentimes', titre: 'Total TTC', sorte: 'montant', largeur: 15 },
        { cle: 'regleCentimes', titre: 'Regle', sorte: 'montant', largeur: 13 },
        { cle: 'resteDuCentimes', titre: 'Reste du', sorte: 'montant', largeur: 13 },
        { cle: 'dateEcheance', titre: 'Echeance', sorte: 'date', largeur: 12 },
      ],
      lignes: donnees.lignes,
      total: {
        numero: 'Total',
        totalHtCentimes: donnees.totaux.totalHtCentimes,
        totalTvaCentimes: donnees.totaux.totalTvaCentimes,
        timbreCentimes: donnees.totaux.timbreCentimes,
        totalTtcCentimes: donnees.totaux.totalTtcCentimes,
        regleCentimes: donnees.totaux.regleCentimes,
        resteDuCentimes: donnees.totaux.resteDuCentimes,
      },
      siVide: 'Aucune facture fournisseur sur la periode.',
    }],
  };
}

export function journalTresorerie(donnees: {
  periode: { debut: Date; fin: Date };
  lignes: Array<Record<string, unknown>>;
  parCategorie: Array<Record<string, unknown>>;
  totaux: Record<string, number>;
}): Rapport {
  return {
    titre: 'Journal de tresorerie',
    sousTitre: periodeEnTexte(donnees.periode),
    enTete: [
      { intitule: 'Operations', valeur: String(donnees.totaux.nombreOperations) },
      { intitule: 'Entrees', valeur: DA(donnees.totaux.entreesCentimes) },
      { intitule: 'Sorties', valeur: DA(donnees.totaux.sortiesCentimes) },
      { intitule: 'Solde de la periode', valeur: DA(donnees.totaux.soldeCentimes) },
    ],
    blocs: [
      {
        titre: 'Par categorie',
        colonnes: [
          { cle: 'categorie', titre: 'Categorie', largeur: 24 },
          { cle: 'nombre', titre: 'Operations', sorte: 'nombre', largeur: 11 },
          { cle: 'entreesCentimes', titre: 'Entrees', sorte: 'montant', largeur: 16 },
          { cle: 'sortiesCentimes', titre: 'Sorties', sorte: 'montant', largeur: 16 },
          { cle: 'soldeCentimes', titre: 'Solde', sorte: 'montant', largeur: 16 },
        ],
        lignes: donnees.parCategorie,
        total: {
          categorie: 'Total',
          nombre: donnees.totaux.nombreOperations,
          entreesCentimes: donnees.totaux.entreesCentimes,
          sortiesCentimes: donnees.totaux.sortiesCentimes,
          soldeCentimes: donnees.totaux.soldeCentimes,
        },
        siVide: 'Aucun mouvement de tresorerie sur la periode.',
      },
      {
        titre: 'Operations',
        colonnes: [
          { cle: 'date', titre: 'Date', sorte: 'horodatage', largeur: 16 },
          { cle: 'magasin', titre: 'Mag.', largeur: 7 },
          { cle: 'numero', titre: 'N°', largeur: 14 },
          { cle: 'compteLibelle', titre: 'Compte', largeur: 20 },
          { cle: 'categorie', titre: 'Categorie', largeur: 20 },
          { cle: 'libelle', titre: 'Libelle', largeur: 30 },
          { cle: 'tiersNom', titre: 'Tiers', largeur: 20 },
          { cle: 'documentNumero', titre: 'Piece', largeur: 15 },
          { cle: 'entreeCentimes', titre: 'Entree', sorte: 'montant', largeur: 14 },
          { cle: 'sortieCentimes', titre: 'Sortie', sorte: 'montant', largeur: 14 },
          { cle: 'soldeApresCentimes', titre: 'Solde apres', sorte: 'montant', largeur: 15 },
          { cle: 'pointee', titre: 'Pointee', sorte: 'booleen', largeur: 9 },
        ],
        lignes: donnees.lignes,
      },
    ],
    note:
      `${donnees.totaux.nombreNonPointees} operation(s) ne sont pas encore pointees au `
      + 'releve bancaire. Le solde apres chaque operation est celui enregistre au moment '
      + 'ou elle a eu lieu, jamais un recalcul : c’est ce qui permet de retrouver ou '
      + 'un ecart est ne.',
  };
}

export function etatDeclaration(donnees: {
  periode: { debut: Date; fin: Date };
  ventes: {
    parTaux: Array<Record<string, number>>;
    baseHtCentimes: number; tvaCollecteeCentimes: number; totalTtcCentimes: number;
  };
  achats: {
    nombrePieces: number; baseHtCentimes: number;
    tvaDeductibleCentimes: number; timbreCentimes: number;
  };
  timbre: { surVentesCentimes: number; nombrePieces: number };
  tvaNetteCentimes: number;
  regimeATvaNulle: boolean;
}): Rapport {
  return {
    titre: 'Etat pour les declarations',
    sousTitre: periodeEnTexte(donnees.periode),
    enTete: [
      { intitule: 'Chiffre d’affaires HT', valeur: DA(donnees.ventes.baseHtCentimes) },
      { intitule: 'TVA collectee', valeur: DA(donnees.ventes.tvaCollecteeCentimes) },
      { intitule: 'TVA deductible', valeur: DA(donnees.achats.tvaDeductibleCentimes) },
      {
        intitule: donnees.tvaNetteCentimes >= 0 ? 'TVA nette due' : 'Credit de TVA',
        valeur: DA(Math.abs(donnees.tvaNetteCentimes)),
      },
    ],
    blocs: [
      {
        titre: 'Ventes par taux de TVA',
        colonnes: [
          { cle: 'taux', titre: 'Taux', sorte: 'pourcent', largeur: 10 },
          { cle: 'nombreLignes', titre: 'Lignes', sorte: 'nombre', largeur: 11 },
          { cle: 'baseHtCentimes', titre: 'Base HT', sorte: 'montant', largeur: 18 },
          { cle: 'tvaCentimes', titre: 'TVA collectee', sorte: 'montant', largeur: 18 },
          { cle: 'totalTtcCentimes', titre: 'Total TTC', sorte: 'montant', largeur: 18 },
        ],
        lignes: donnees.ventes.parTaux,
        total: {
          taux: null,
          baseHtCentimes: donnees.ventes.baseHtCentimes,
          tvaCentimes: donnees.ventes.tvaCollecteeCentimes,
          totalTtcCentimes: donnees.ventes.totalTtcCentimes,
        },
        siVide: 'Aucune vente sur la periode.',
      },
      {
        titre: 'Achats et droit de timbre',
        colonnes: [
          { cle: 'intitule', titre: 'Intitule', largeur: 34 },
          { cle: 'nombre', titre: 'Pieces', sorte: 'nombre', largeur: 11 },
          { cle: 'montantCentimes', titre: 'Montant', sorte: 'montant', largeur: 18 },
        ],
        lignes: [
          {
            intitule: 'Achats HT',
            nombre: donnees.achats.nombrePieces,
            montantCentimes: donnees.achats.baseHtCentimes,
          },
          {
            intitule: 'TVA deductible sur achats',
            nombre: null,
            montantCentimes: donnees.achats.tvaDeductibleCentimes,
          },
          {
            intitule: 'Droit de timbre sur ventes',
            nombre: donnees.timbre.nombrePieces,
            montantCentimes: donnees.timbre.surVentesCentimes,
          },
          {
            intitule: 'Droit de timbre sur achats',
            nombre: null,
            montantCentimes: donnees.achats.timbreCentimes,
          },
        ],
      },
    ],
    note:
      'Ceci n’est pas une declaration remplie : seul votre comptable peut reporter '
      + 'ces montants dans les cases du formulaire, et le regime fiscal exact reste a '
      + 'confirmer avec lui. Ce que GestGlobale garantit, c’est que chaque total '
      + 'vient des pieces, au centime, et qu’on peut remonter de ce tableau aux '
      + 'lignes qui le composent par le journal des ventes.'
      + (donnees.regimeATvaNulle
        ? ' Sur cette periode, toutes les ventes sont a TVA 0 : c’est ce que porte '
          + 'le catalogue repris de l’ancien logiciel, et c’est precisement le '
          + 'point a trancher avec votre comptable.'
        : ''),
  };
}

/** Rappel : le libelle des modes de reglement vient du noyau partage. */
export { libelleModePaiement };
