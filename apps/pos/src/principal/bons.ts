import type Database from 'better-sqlite3';
import { evaluerBon, type BonConnu, type DecisionBon } from '@gestglobale/shared';

/**
 * Bons d'achat et cartes cadeaux, cote caisse.
 *
 * Le solde connu est celui de la derniere synchronisation. Hors ligne,
 * la caisse ne peut pas savoir qu'une autre vient de debiter le meme
 * bon : elle accepte jusqu'au solde qu'elle connait, et le serveur
 * signale tout decouvert a la remontee. Refuser un bon pendant une
 * coupure serait penible pour le client, et la marchandise est deja
 * prise.
 */

interface LigneBon {
  code: string;
  type: string;
  solde_centimes: number;
  expire_le: string | null;
  actif: number;
}

export function bonParCode(base: Database.Database, code: string): BonConnu | null {
  const ligne = base
    .prepare('SELECT * FROM bon_achat WHERE code = ?')
    .get(code.trim().toUpperCase()) as LigneBon | undefined;
  if (!ligne) return null;
  return {
    code: ligne.code,
    soldeCentimes: ligne.solde_centimes,
    expireLe: ligne.expire_le,
    actif: ligne.actif === 1,
  };
}

/** Le bon couvre-t-il ce montant ? Le solde local n'est pas encore debite. */
export function presenterBon(
  base: Database.Database,
  code: string,
  montantCentimes: number,
  maintenant = new Date(),
): DecisionBon & { code: string } {
  const bon = bonParCode(base, code);
  return { ...evaluerBon(bon, montantCentimes, maintenant), code: code.trim().toUpperCase() };
}

/**
 * Debite le solde local apres encaissement.
 *
 * Purement local : le solde qui fait foi est celui du serveur, applique
 * a la remontee. Ce debit evite seulement qu'un meme bon soit represente
 * plusieurs fois sur la meme caisse avant la synchronisation suivante.
 */
export function debiterLocalement(
  base: Database.Database,
  code: string,
  montantCentimes: number,
): void {
  base
    .prepare(
      `UPDATE bon_achat
          SET solde_centimes = MAX(0, solde_centimes - ?)
        WHERE code = ?`,
    )
    .run(Math.max(0, montantCentimes), code.trim().toUpperCase());
}
