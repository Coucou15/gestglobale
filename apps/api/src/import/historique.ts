import { OrigineHistorique, Prisma } from '@prisma/client';
import { champ, nombre, dateOuNull, type LigneBrute, type OngletLu } from './lecture';

/**
 * Reprise de l'historique de l'ancien logiciel (section 7).
 *
 * Cet historique est consultable, pas rejouable. Le stock repris par
 * l'import est celui constate a la fin de la journee exportee, et
 * l'onglet STOCKS contient les mouvements de cette meme journee : les
 * rejouer dans le journal de stock compterait deux fois la marchandise.
 * De meme, l'export ne donne aucun solde d'ouverture de tresorerie, donc
 * rejouer ses 450 ecritures donnerait des soldes faux.
 *
 * Chaque ligne conserve en outre sa version d'origine, intacte, pour
 * qu'aucune colonne non exploitee aujourd'hui ne soit perdue.
 */

export interface LignePreparee {
  origine: OrigineHistorique;
  ongletSource: string;
  ligneSource: number;
  date: Date | null;
  heure: string | null;
  type: string | null;
  numeroDocument: string | null;
  reference: string | null;
  libelle: string | null;
  tiersCode: string | null;
  tiersNom: string | null;
  utilisateur: string | null;
  caisse: string | null;
  magasin: string | null;
  modeReglement: string | null;
  quantiteMilli: number | null;
  montantHtCentimes: bigint | null;
  montantTvaCentimes: bigint | null;
  montantTimbreCentimes: bigint | null;
  montantTtcCentimes: bigint | null;
  margeCentimes: bigint | null;
  donnees: Prisma.InputJsonValue;
}

const vide = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** Montant du fichier (en dinars) vers des centimes entiers. */
function centimes(valeur: string): bigint | null {
  const n = nombre(valeur);
  return n === null ? null : BigInt(Math.round(n * 100));
}

function milli(valeur: string): number | null {
  const n = nombre(valeur);
  return n === null ? null : Math.round(n * 1000);
}

/** La ligne d'origine, telle quelle, sans les colonnes vides. */
function brute(ligne: LigneBrute): Prisma.InputJsonValue {
  const retenu: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(ligne.valeurs)) {
    if (valeur !== '' && cle !== 'n') retenu[cle] = valeur;
  }
  return retenu;
}

type Convertisseur = (ligne: LigneBrute, onglet: string) => LignePreparee;

const base = (
  ligne: LigneBrute,
  onglet: string,
  origine: OrigineHistorique,
): LignePreparee => ({
  origine,
  ongletSource: onglet,
  ligneSource: ligne.numero,
  date: null, heure: null, type: null, numeroDocument: null, reference: null,
  libelle: null, tiersCode: null, tiersNom: null, utilisateur: null,
  caisse: null, magasin: null, modeReglement: null, quantiteMilli: null,
  montantHtCentimes: null, montantTvaCentimes: null, montantTimbreCentimes: null,
  montantTtcCentimes: null, margeCentimes: null,
  donnees: brute(ligne),
});

/** SORTIES : ventes, bons de livraison, retours clients. */
const sorties: Convertisseur = (ligne, onglet) => ({
  ...base(ligne, onglet, OrigineHistorique.VENTE),
  date: dateOuNull(champ(ligne, 'DATE DOCUMENT', 'DATE')),
  heure: vide(champ(ligne, 'HEURE')),
  type: vide(champ(ligne, 'TYPE SORTIE', 'TYPE')),
  numeroDocument: vide(champ(ligne, 'NUMERO DOCUMENT', 'NUMERO')),
  tiersCode: vide(champ(ligne, 'CLIENT OU MAGASIN', 'CLIENT')),
  tiersNom: vide(champ(ligne, 'RAISON SOCIALE')),
  libelle: vide(champ(ligne, 'LIBELLE COMPTE')),
  utilisateur: vide(champ(ligne, 'UTILISATEUR')),
  caisse: vide(champ(ligne, 'CAISSE')),
  modeReglement: vide(champ(ligne, 'MODE REGLEMENT')),
  montantHtCentimes: centimes(champ(ligne, 'MONTANT HT')),
  montantTvaCentimes: centimes(champ(ligne, 'MONTANT TVA')),
  montantTimbreCentimes: centimes(champ(ligne, 'MONTANT TIMBRE')),
  montantTtcCentimes: centimes(champ(ligne, 'TOTAL REGLE')),
  // La marge se deduit du cout d'achat porte par la ligne.
  margeCentimes: (() => {
    const vente = nombre(champ(ligne, 'MONTANT HT'));
    const achat = nombre(champ(ligne, 'MONTANT HT ACHAT'));
    return vente === null || achat === null
      ? null
      : BigInt(Math.round((vente - achat) * 100));
  })(),
});

/** ENTREES : receptions fournisseurs. */
const entrees: Convertisseur = (ligne, onglet) => ({
  ...base(ligne, onglet, OrigineHistorique.RECEPTION),
  date: dateOuNull(champ(ligne, 'DATE RECEPTION', 'DATE')),
  heure: vide(champ(ligne, 'HEURE')),
  type: vide(champ(ligne, 'TYPE ENTREE', 'TYPE')),
  numeroDocument: vide(champ(ligne, 'NUMERO RECEPTION', 'NUMERO')),
  tiersCode: vide(champ(ligne, 'FOURNISSEUR OU DEPOT', 'FOURNISSEUR')),
  tiersNom: vide(champ(ligne, 'RAISON SOCIALE')),
  libelle: vide(champ(ligne, 'OBSERVATIONS')),
  utilisateur: vide(champ(ligne, 'UTILISATEUR')),
  modeReglement: vide(champ(ligne, 'MODE REGLEMENT')),
  montantHtCentimes: centimes(champ(ligne, 'MONTANT HT')),
  montantTvaCentimes: centimes(champ(ligne, 'MONTANT TVA')),
  montantTimbreCentimes: centimes(champ(ligne, 'MONTANT TIMBRE')),
  montantTtcCentimes: centimes(champ(ligne, 'TOTAL REGLE')),
});

/** STOCKS : mouvements article par article. */
const stocks: Convertisseur = (ligne, onglet) => {
  const entree = nombre(champ(ligne, 'QTE ENTREE')) ?? 0;
  const sortie = nombre(champ(ligne, 'QTE SORTIE')) ?? 0;
  return {
    ...base(ligne, onglet, OrigineHistorique.MOUVEMENT_STOCK),
    date: dateOuNull(champ(ligne, 'DATE DOCUMENT', 'DATE')),
    heure: vide(champ(ligne, 'TIME', 'HEURE')),
    type: vide(champ(ligne, 'TYPE MOUVEMENT', 'TYPE')),
    numeroDocument: vide(champ(ligne, 'NUMERO DOCUMENT', 'NUMERO')),
    reference: vide(champ(ligne, 'PRODUIT')),
    libelle: vide(champ(ligne, 'DESIGNATION PRODUIT', 'DESIGNATION')),
    tiersCode: vide(champ(ligne, 'CLIENT/FOURNISSEUR')),
    tiersNom: vide(champ(ligne, 'RAISON SOCIALE')),
    utilisateur: vide(champ(ligne, 'UTILISATEUR')),
    caisse: vide(champ(ligne, 'CAISSE')),
    magasin: vide(champ(ligne, 'MAGASIN')),
    // Signee : positive a l'entree, negative a la sortie.
    quantiteMilli: milli(String(entree - sortie)),
    montantHtCentimes: centimes(champ(ligne, 'PRIX VENTE')),
    montantTvaCentimes: centimes(champ(ligne, 'TAUX TVA')),
    margeCentimes: centimes(champ(ligne, 'MARGE')),
  };
};

/** TRESORERIE : encaissements, decaissements, depenses. */
const tresorerie: Convertisseur = (ligne, onglet) => ({
  ...base(ligne, onglet, OrigineHistorique.TRESORERIE),
  date: dateOuNull(champ(ligne, 'DATE REGLEMENT', 'DATE')),
  heure: vide(champ(ligne, 'HEURE')),
  type: vide(champ(ligne, 'TYPE MOUVEMENT', 'TYPE')),
  numeroDocument: vide(champ(ligne, 'NUMERO FACTURE', 'NUMERO PIECE')),
  reference: vide(champ(ligne, 'COMPTE TRESORERIE', 'COMPTE')),
  libelle: vide(
    champ(ligne, 'LIBELLE OPERATION', 'INTITULE OPERATION', 'LIBELLE COMPTE'),
  ),
  tiersCode: vide(champ(ligne, 'TIERS')),
  tiersNom: vide(champ(ligne, 'RAISON SOCIALE')),
  utilisateur: vide(champ(ligne, 'UTILISATEUR')),
  caisse: vide(champ(ligne, 'CAISSE')),
  modeReglement: vide(champ(ligne, 'MODE REGLEMENT')),
  montantTtcCentimes: centimes(champ(ligne, 'MONTANT REGLE')),
});

/** RASEES : clotures de caisse. */
const rasees: Convertisseur = (ligne, onglet) => {
  const comptable = nombre(champ(ligne, 'RECETTE COMPTABLE ES')) ?? 0;
  const physique = nombre(champ(ligne, 'RECETTE PHYSIQUE ES')) ?? 0;
  const difference = nombre(champ(ligne, 'DIFFERENCE'));
  return {
    ...base(ligne, onglet, OrigineHistorique.CLOTURE_CAISSE),
    date: dateOuNull(champ(ligne, 'DATE')),
    type: 'CLOTURE',
    caisse: vide(champ(ligne, 'CAISSE')),
    utilisateur: vide(champ(ligne, 'VENDEUR')),
    libelle:
      `Recette comptable ${comptable} DA, recette physique ${physique} DA` +
      (physique === 0 && comptable !== 0 ? ' — comptage non saisi' : ''),
    montantHtCentimes: centimes(champ(ligne, 'RECETTE COMPTABLE ES')),
    montantTtcCentimes: centimes(champ(ligne, 'RECETTE PHYSIQUE ES')),
    // L'ecart est repris tel quel, et non recalcule : c'est ce qu'a
    // constate l'ancien logiciel qui fait foi pour l'historique.
    margeCentimes:
      difference === null ? null : BigInt(Math.round(difference * 100)),
  };
};

/** Onglets d'historique, par nom normalise. */
export const ONGLETS_HISTORIQUE: Record<string, Convertisseur> = {
  sorties: sorties,
  entrees: entrees,
  stocks: stocks,
  tresorerie: tresorerie,
  rasees: rasees,
};

export function cleHistorique(nom: string): string | null {
  const n = nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return n in ONGLETS_HISTORIQUE ? n : null;
}

/** Prepare les lignes d'historique d'un onglet. */
export function preparerHistorique(onglet: OngletLu): LignePreparee[] {
  const cle = cleHistorique(onglet.nom);
  if (!cle) return [];
  const convertir = ONGLETS_HISTORIQUE[cle];
  return onglet.lignes.map((ligne) => convertir(ligne, onglet.nom));
}
