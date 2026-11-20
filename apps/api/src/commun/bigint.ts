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

/** Convertit en centimes (number) une valeur venue de Prisma. */
export function c(valeur: bigint | number | null | undefined): number {
  if (valeur === null || valeur === undefined) return 0;
  return typeof valeur === 'bigint' ? Number(valeur) : valeur;
}

/** Convertit des centimes vers le BigInt attendu par Prisma. */
export function b(centimes: number): bigint {
  return BigInt(Math.round(centimes));
}
