import { Centimes } from './money';

/**
 * Vente a credit : plafond par client et blocage automatique.
 *
 * Hors ligne, la caisse ne connait que la situation de la derniere
 * synchronisation : le cahier des charges autorise la vente dans la limite
 * de ce plafond connu, au-dela un code superviseur est exige (section 4.5).
 */

export type MotifBlocage = 'PLAFOND_DEPASSE' | 'BLOQUE_MANUEL' | 'IMPAYE_ECHU' | null;

export interface SituationClient {
  soldeCentimes: Centimes;
  plafondCentimes: Centimes;
  bloqueManuellement: boolean;
  motifBlocageManuel?: string | null;
  /** Montant des echeances depassees, si le suivi d'echeancier est actif. */
  impayeEchuCentimes?: Centimes;
}

export interface DecisionCredit {
  autorise: boolean;
  motif: MotifBlocage;
  message: string | null;
  /** Vrai si un code superviseur permet de forcer la vente. */
  forcagePossible: boolean;
  soldeApresCentimes: Centimes;
  /** Montant encore disponible avant blocage. */
  disponibleCentimes: Centimes;
}

export function evaluerCredit(
  situation: SituationClient,
  montantCentimes: Centimes,
  options: { horsLigne?: boolean } = {},
): DecisionCredit {
  const soldeApres = situation.soldeCentimes + montantCentimes;
  const disponible = situation.plafondCentimes - situation.soldeCentimes;

  if (situation.bloqueManuellement) {
    return {
      autorise: false,
      motif: 'BLOQUE_MANUEL',
      message: situation.motifBlocageManuel || 'Client bloque',
      forcagePossible: false,
      soldeApresCentimes: soldeApres,
      disponibleCentimes: disponible,
    };
  }

  if ((situation.impayeEchuCentimes ?? 0) > 0) {
    return {
      autorise: false,
      motif: 'IMPAYE_ECHU',
      message: 'Echeance depassee : reglement requis avant toute nouvelle vente a credit',
      forcagePossible: true,
      soldeApresCentimes: soldeApres,
      disponibleCentimes: disponible,
    };
  }

  if (situation.plafondCentimes > 0 && soldeApres > situation.plafondCentimes) {
    return {
      autorise: false,
      motif: 'PLAFOND_DEPASSE',
      message: options.horsLigne
        ? 'Plafond connu hors ligne depasse : code superviseur requis'
        : 'Plafond de credit depasse',
      forcagePossible: true,
      soldeApresCentimes: soldeApres,
      disponibleCentimes: disponible,
    };
  }

  return {
    autorise: true,
    motif: null,
    message: null,
    forcagePossible: false,
    soldeApresCentimes: soldeApres,
    disponibleCentimes: disponible,
  };
}
