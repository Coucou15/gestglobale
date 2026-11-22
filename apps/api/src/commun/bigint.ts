/**
 * Les montants sont des BigInt en base (centimes exacts). JSON ne sait pas
 * les serialiser : on les rend en nombre, ce qui reste exact tant qu'on
 * demeure sous 2^53 centimes, soit 90 000 milliards de dinars.
 */
export function installerSerialisationBigInt(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BigInt.prototype as any).toJSON = function toJSON(this: bigint): number {
    const n = Number(this);
    if (!Number.isSafeInteger(n)) {
      throw new Error(`Montant hors des entiers surs : ${this.toString()}`);
    }
    return n;
  };
}

/**
 * Convertit en centimes (number) une valeur venue de Prisma.
 *
 * Le cas qui compte est celui des agregats : `SUM()` sur une colonne
 * bigint rend un `numeric` en PostgreSQL, que Prisma remonte en Decimal
 * et non en bigint. Laisser passer cet objet tel quel le faisait
 * serialiser en chaine — « 161250 » au lieu de 161250 — et la premiere
 * addition le concatenait au lieu de l'ajouter : une tresorerie de
 * 1 612,50 DA devenait 16 125,00 DA. Les ecrans n'y voyaient rien, parce
 * qu'ils rappellent Number() avant d'afficher.
 *
 * Tout ce qui ressemble a un nombre est donc ramene ici, une fois pour
 * toutes, a un vrai nombre.
 */
export function c(valeur: unknown): number {
  if (valeur === null || valeur === undefined) return 0;
  if (typeof valeur === 'number') return valeur;
  if (typeof valeur === 'bigint') return Number(valeur);
  // Decimal de Prisma, chaine, ou tout objet qui sait se dire en texte.
  const n = Number(
    typeof valeur === 'object' && valeur !== null && 'toString' in valeur
      ? (valeur as { toString(): string }).toString()
      : valeur,
  );
  if (!Number.isFinite(n)) {
    throw new Error(`Montant illisible venu de la base : ${String(valeur)}`);
  }
  return n;
}

/** Convertit des centimes vers le BigInt attendu par Prisma. */
export function b(centimes: number): bigint {
  return BigInt(Math.round(centimes));
}
