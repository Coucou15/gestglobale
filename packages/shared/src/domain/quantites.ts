/**
 * Quantites : stockees en milli-unites entieres pour eviter toute derive
 * sur les produits vendus au poids (0,250 KG) ou au litre.
 */

export type MilliUnites = number;

export const MILLI = 1000;

/** Unites de mesure normalisees du catalogue (section 7 du cahier des charges). */
export type UniteMesure = 'UN' | 'KG' | 'L' | 'M';

/** Nombre de decimales autorisees par unite. */
export const DECIMALES_PAR_UNITE: Record<UniteMesure, number> = {
  UN: 0,
  KG: 3,
  L: 3,
  M: 2,
};

/**
 * Normalise une unite telle qu'elle sort de l'ancien logiciel.
 * U -> UN, K -> KG, GR -> KG (avec conversion du facteur), etc.
 * Retourne l'unite normalisee et le facteur a appliquer a la quantite.
 */
export function normaliserUnite(brute: string | null | undefined): {
  unite: UniteMesure;
  facteur: number;
  suspecte: boolean;
} {
  const v = (brute ?? '').trim().toUpperCase();
  switch (v) {
    case 'UN':
    case 'U':
    case 'UNITE':
    case 'PCE':
    case 'P':
    case '':
      return { unite: 'UN', facteur: 1, suspecte: v === '' };
    case 'KG':
    case 'K':
    case 'KILO':
      return { unite: 'KG', facteur: 1, suspecte: false };
    case 'GR':
    case 'G':
    case 'GRAMME':
      return { unite: 'KG', facteur: 0.001, suspecte: false };
    case 'L':
    case 'LT':
    case 'LITRE':
      return { unite: 'L', facteur: 1, suspecte: false };
    case 'ML':
      return { unite: 'L', facteur: 0.001, suspecte: false };
    case 'M':
    case 'ML2':
    case 'METRE':
      return { unite: 'M', facteur: 1, suspecte: false };
    default:
      // Valeurs aberrantes de l'export ("." , "+", "28272") : on retient UN
      // et on signale la ligne pour correction manuelle.
      return { unite: 'UN', facteur: 1, suspecte: true };
  }
}

export function versMilli(quantite: number): MilliUnites {
  return Math.round(quantite * MILLI);
}

export function versQuantite(milli: MilliUnites): number {
  return Math.round(milli) / MILLI;
}

/** Formate une quantite selon les decimales de son unite. */
export function formaterQuantite(milli: MilliUnites, unite: UniteMesure): string {
  const decimales = DECIMALES_PAR_UNITE[unite];
  return versQuantite(milli).toFixed(decimales).replace('.', ',');
}

/** Verifie qu'une quantite est compatible avec son unite (pas de 0,5 piece). */
export function quantiteValide(milli: MilliUnites, unite: UniteMesure): boolean {
  if (unite === 'UN') return milli % MILLI === 0;
  return Number.isInteger(milli);
}
