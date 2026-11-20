import { Centimes, arrondi } from './money';
import { MilliUnites } from './quantites';

/**
 * CUMP : cout unitaire moyen pondere.
 *
 * Il est recalcule a chaque entree valorisee (reception fournisseur,
 * transfert entrant valorise, ajustement d'inventaire en hausse).
 * Les sorties ne modifient jamais le CUMP.
 */

export interface EtatValorisation {
  /** Stock avant l'entree, en milli-unites. */
  stockMilli: MilliUnites;
  /** CUMP avant l'entree, en centimes par unite. */
  cumpCentimes: Centimes;
}

export interface EntreeValorisee {
  /** Quantite entrante, en milli-unites. */
  quantiteMilli: MilliUnites;
  /** Prix d'achat unitaire net de remise, en centimes. */
  prixAchatCentimes: Centimes;
}

/**
 * Nouveau CUMP apres une entree.
 *
 * Cas particuliers volontairement explicites :
 * - stock anterieur negatif ou nul : le CUMP devient le prix d'achat de
 *   l'entree (sinon un stock negatif fausse durablement la valorisation) ;
 * - quantite entrante nulle : le CUMP est inchange.
 */
export function recalculerCump(
  etat: EtatValorisation,
  entree: EntreeValorisee,
): Centimes {
  if (entree.quantiteMilli <= 0) return etat.cumpCentimes;
  if (etat.stockMilli <= 0) return arrondi(entree.prixAchatCentimes);

  const valeurExistante = etat.stockMilli * etat.cumpCentimes;
  const valeurEntrante = entree.quantiteMilli * entree.prixAchatCentimes;
  const quantiteTotale = etat.stockMilli + entree.quantiteMilli;

  return arrondi((valeurExistante + valeurEntrante) / quantiteTotale);
}

/** Valeur du stock au CUMP, en centimes. */
export function valeurStock(stockMilli: MilliUnites, cumpCentimes: Centimes): Centimes {
  return arrondi((stockMilli * cumpCentimes) / 1000);
}

/**
 * Marge d'une ligne de vente.
 * Un resultat negatif signale une vente a perte (rapport M9).
 */
export function margeLigne(params: {
  quantiteMilli: MilliUnites;
  prixVenteCentimes: Centimes;
  cumpCentimes: Centimes;
}): { margeCentimes: Centimes; tauxPourcent: number; venteAPerte: boolean } {
  const ca = arrondi((params.quantiteMilli * params.prixVenteCentimes) / 1000);
  const cout = arrondi((params.quantiteMilli * params.cumpCentimes) / 1000);
  const marge = ca - cout;
  const taux = ca === 0 ? 0 : Math.round((marge / ca) * 10000) / 100;
  return {
    margeCentimes: marge,
    tauxPourcent: taux,
    venteAPerte: params.prixVenteCentimes < params.cumpCentimes,
  };
}

/**
 * Prix de vente propose apres une reception, en conservant le taux de marge
 * actuel ou en appliquant un taux cible.
 */
export function prixVenteDepuisMarge(cumpCentimes: Centimes, tauxMargePourcent: number): Centimes {
  if (tauxMargePourcent >= 100) {
    throw new Error('Un taux de marge sur prix de vente doit rester sous 100 %');
  }
  return arrondi(cumpCentimes / (1 - tauxMargePourcent / 100));
}
