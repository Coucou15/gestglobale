/**
 * Montants en dinar algerien (DA).
 *
 * Regle du projet : aucun calcul monetaire n'est fait en nombre flottant.
 * Tout montant circule en *centimes* (entier). La conversion en DA
 * n'a lieu qu'a l'affichage ou a l'ecriture en base (Decimal(14,2)).
 */

export type Centimes = number;

export const CENTIMES_PAR_DINAR = 100;

/** Arrondi commercial (0,5 arrondi vers le haut en valeur absolue). */
export function arrondi(valeur: number): number {
  return valeur < 0 ? -Math.round(-valeur) : Math.round(valeur);
}

/** Convertit un montant en DA (nombre ou chaine) vers des centimes entiers. */
export function versCentimes(montantDA: number | string): Centimes {
  const n = typeof montantDA === 'string' ? Number(montantDA.replace(',', '.')) : montantDA;
  if (!Number.isFinite(n)) {
    throw new Error(`Montant invalide : ${montantDA}`);
  }
  return arrondi(n * CENTIMES_PAR_DINAR);
}

/** Convertit des centimes vers un nombre en DA a 2 decimales. */
export function versDinars(centimes: Centimes): number {
  return arrondi(centimes) / CENTIMES_PAR_DINAR;
}

/** Formate un montant pour l'affichage : "1 234,50 DA". */
export function formaterDA(centimes: Centimes, options: { devise?: boolean } = {}): string {
  const avecDevise = options.devise !== false;
  const negatif = centimes < 0;
  const absolu = Math.abs(arrondi(centimes));
  const entier = Math.floor(absolu / CENTIMES_PAR_DINAR).toString();
  const decimales = (absolu % CENTIMES_PAR_DINAR).toString().padStart(2, '0');
  const groupes = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${negatif ? '-' : ''}${groupes},${decimales}${avecDevise ? ' DA' : ''}`;
}

/**
 * Applique un pourcentage a un montant (remise, taxe, marge).
 * @param pourcentage ex. 19 pour 19 %
 */
export function pourcentageDe(centimes: Centimes, pourcentage: number): Centimes {
  return arrondi((centimes * pourcentage) / 100);
}

/** Somme sure d'une liste de montants. */
export function somme(montants: Centimes[]): Centimes {
  return montants.reduce((total, m) => total + arrondi(m), 0);
}

/**
 * Rendu de monnaie decompose en coupures disponibles.
 * Les coupures sont exprimees en centimes, triees decroissant.
 */
export function decomposerRendu(
  rendu: Centimes,
  coupures: Centimes[],
): Array<{ coupure: Centimes; nombre: number }> {
  const resultat: Array<{ coupure: Centimes; nombre: number }> = [];
  let reste = Math.max(0, arrondi(rendu));
  for (const coupure of [...coupures].sort((a, b) => b - a)) {
    if (coupure <= 0) continue;
    const nombre = Math.floor(reste / coupure);
    if (nombre > 0) {
      resultat.push({ coupure, nombre });
      reste -= nombre * coupure;
    }
  }
  return resultat;
}
