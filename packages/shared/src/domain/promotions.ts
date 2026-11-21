import { Centimes, arrondi, pourcentageDe } from './money';
import { MilliUnites, MILLI } from './quantites';

/**
 * Promotions (M10).
 *
 * Le calcul vit ici, partage par la caisse et le serveur, pour qu'un
 * ticket etabli hors ligne et le meme ticket rejoue au serveur donnent
 * exactement le meme montant. Une promotion appliquee en caisse ne doit
 * jamais etre recalculee differemment a la remontee.
 */

export type TypePromotion = 'PRIX_BARRE' | 'X_POUR_Y' | 'REMISE_FAMILLE' | 'HAPPY_HOUR';

export interface Promotion {
  id: string;
  libelle: string;
  type: TypePromotion;
  /** Bornes de validite, au format ISO. */
  debut: string;
  fin: string;
  articleId: string | null;
  familleId: string | null;
  /** Prix barre : le nouveau prix unitaire, en centimes. */
  valeurCentimes: Centimes | null;
  /** Remise famille ou happy hour, en pourcentage. */
  remisePourcent: number | null;
  /** X pour Y : nombre d'unites a acheter. */
  quantiteDeclenchement: number | null;
  /** X pour Y : nombre d'unites offertes. */
  quantiteOfferte: number | null;
  /** Happy hour : plage horaire, "18:00" a "20:00". */
  heureDebut: string | null;
  heureFin: string | null;
  /** Vrai si la promotion se cumule avec une autre sur la meme ligne. */
  cumulable: boolean;
}

export interface LignePromotionnable {
  articleId: string;
  familleId: string | null;
  quantiteMilli: MilliUnites;
  prixUnitaireCentimes: Centimes;
}

export interface AvantageLigne {
  promotionId: string;
  libelle: string;
  type: TypePromotion;
  /** Remise obtenue sur la ligne entiere, en centimes. */
  remiseCentimes: Centimes;
  /** Prix unitaire de remplacement, pour un prix barre. */
  prixUnitaireCentimes: Centimes | null;
  /** Unites offertes, pour un X pour Y. */
  unitesOffertesMilli: MilliUnites;
}

function enMinutes(heure: string | null): number | null {
  if (!heure) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(heure.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Une promotion est-elle en vigueur a cet instant ?
 *
 * Une happy hour peut traverser minuit (22:00 a 02:00) : la plage est
 * alors lue comme deux intervalles, faute de quoi elle ne s'appliquerait
 * jamais.
 */
export function promotionEnVigueur(promotion: Promotion, maintenant = new Date()): boolean {
  const debut = new Date(promotion.debut);
  const fin = new Date(promotion.fin);
  if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) return false;
  if (maintenant < debut || maintenant > fin) return false;

  if (promotion.type !== 'HAPPY_HOUR') return true;

  const ouverture = enMinutes(promotion.heureDebut);
  const fermeture = enMinutes(promotion.heureFin);
  if (ouverture === null || fermeture === null) return false;

  const minute = maintenant.getHours() * 60 + maintenant.getMinutes();
  return ouverture <= fermeture
    ? minute >= ouverture && minute <= fermeture
    : minute >= ouverture || minute <= fermeture;
}

/** La promotion vise-t-elle cette ligne ? */
function viseLaLigne(promotion: Promotion, ligne: LignePromotionnable): boolean {
  if (promotion.articleId) return promotion.articleId === ligne.articleId;
  if (promotion.familleId) return promotion.familleId === ligne.familleId;
  // Sans article ni famille, la promotion vise tout le catalogue.
  return true;
}

/** Avantage apporte par une promotion a une ligne, ou null. */
function calculerAvantage(
  promotion: Promotion,
  ligne: LignePromotionnable,
): AvantageLigne | null {
  const brut = arrondi((ligne.quantiteMilli * ligne.prixUnitaireCentimes) / MILLI);
  if (brut <= 0) return null;

  const base = {
    promotionId: promotion.id,
    libelle: promotion.libelle,
    type: promotion.type,
    prixUnitaireCentimes: null as Centimes | null,
    unitesOffertesMilli: 0,
  };

  switch (promotion.type) {
    case 'PRIX_BARRE': {
      const prix = promotion.valeurCentimes;
      // Un prix barre superieur au prix courant n'est pas une promotion :
      // on ne pousse jamais un client a payer davantage.
      if (prix === null || prix < 0 || prix >= ligne.prixUnitaireCentimes) return null;
      const nouveau = arrondi((ligne.quantiteMilli * prix) / MILLI);
      return { ...base, remiseCentimes: brut - nouveau, prixUnitaireCentimes: prix };
    }

    case 'X_POUR_Y': {
      const achetees = promotion.quantiteDeclenchement;
      const offertes = promotion.quantiteOfferte;
      if (!achetees || !offertes || achetees <= 0 || offertes <= 0) return null;

      // Le lot complet vaut (achetees + offertes) unites ; on compte
      // combien de lots entiers tiennent dans la ligne.
      const lot = achetees + offertes;
      const unites = Math.floor(ligne.quantiteMilli / MILLI);
      const lots = Math.floor(unites / lot);
      if (lots === 0) return null;

      const gratuites = lots * offertes;
      return {
        ...base,
        remiseCentimes: arrondi(gratuites * ligne.prixUnitaireCentimes),
        unitesOffertesMilli: gratuites * MILLI,
      };
    }

    case 'REMISE_FAMILLE':
    case 'HAPPY_HOUR': {
      const taux = promotion.remisePourcent;
      if (!taux || taux <= 0 || taux > 100) return null;
      return { ...base, remiseCentimes: pourcentageDe(brut, taux) };
    }

    default:
      return null;
  }
}

/**
 * Meilleur avantage applicable a une ligne.
 *
 * Les promotions non cumulables ne s'additionnent pas : on retient celle
 * qui avantage le plus le client. Les cumulables s'ajoutent par-dessus,
 * sans jamais pouvoir rendre la ligne negative.
 */
export function avantagesDeLaLigne(
  ligne: LignePromotionnable,
  promotions: Promotion[],
  maintenant = new Date(),
): AvantageLigne[] {
  const candidates = promotions.filter(
    (p) => promotionEnVigueur(p, maintenant) && viseLaLigne(p, ligne),
  );
  if (candidates.length === 0) return [];

  const evaluees = candidates
    .map((p) => ({ promotion: p, avantage: calculerAvantage(p, ligne) }))
    .filter((e): e is { promotion: Promotion; avantage: AvantageLigne } => e.avantage !== null);
  if (evaluees.length === 0) return [];

  const cumulables = evaluees.filter((e) => e.promotion.cumulable);
  const exclusives = evaluees.filter((e) => !e.promotion.cumulable);

  const retenues: AvantageLigne[] = [];
  if (exclusives.length > 0) {
    // A egalite, la premiere declaree l'emporte : le resultat ne doit pas
    // dependre de l'ordre de lecture de la base.
    const meilleure = exclusives.reduce((a, b) =>
      b.avantage.remiseCentimes > a.avantage.remiseCentimes ? b : a,
    );
    retenues.push(meilleure.avantage);
  }
  retenues.push(...cumulables.map((e) => e.avantage));

  // La remise totale ne peut pas depasser le montant de la ligne.
  const brut = arrondi((ligne.quantiteMilli * ligne.prixUnitaireCentimes) / MILLI);
  let cumul = 0;
  const bornees: AvantageLigne[] = [];
  for (const avantage of retenues) {
    const place = Math.max(0, brut - cumul);
    const remise = Math.min(avantage.remiseCentimes, place);
    if (remise <= 0 && avantage.unitesOffertesMilli === 0) continue;
    cumul += remise;
    bornees.push({ ...avantage, remiseCentimes: remise });
  }
  return bornees;
}

/** Points de fidelite gagnes par un ticket (M10). */
export interface BaremeFidelite {
  actif: boolean;
  /** Montant depense, en centimes, donnant un point. */
  centimesParPoint: Centimes;
  /** Valeur d'un point en centimes, pour la conversion en remise. */
  valeurPointCentimes: Centimes;
  /** Nombre de points minimum avant de pouvoir les utiliser. */
  minimumUtilisation: number;
}

export const BAREME_FIDELITE_DEFAUT: BaremeFidelite = {
  actif: false,
  centimesParPoint: 10000,
  valeurPointCentimes: 100,
  minimumUtilisation: 50,
};

export function pointsGagnes(
  montantTtcCentimes: Centimes,
  bareme: BaremeFidelite = BAREME_FIDELITE_DEFAUT,
): number {
  if (!bareme.actif || bareme.centimesParPoint <= 0 || montantTtcCentimes <= 0) return 0;
  return Math.floor(montantTtcCentimes / bareme.centimesParPoint);
}

export function valeurDesPoints(
  points: number,
  bareme: BaremeFidelite = BAREME_FIDELITE_DEFAUT,
): Centimes {
  if (!bareme.actif || points < bareme.minimumUtilisation) return 0;
  return arrondi(points * bareme.valeurPointCentimes);
}
