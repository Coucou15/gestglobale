import { Centimes, arrondi, pourcentageDe, somme } from './money';
import { MilliUnites } from './quantites';

/** Les 5 categories de prix client reprises de l'ancien logiciel. */
export type CategoriePrix = 'DETAIL' | 'GROS' | 'CAT3' | 'CAT4' | 'CAT5';

export const CATEGORIES_PRIX: CategoriePrix[] = ['DETAIL', 'GROS', 'CAT3', 'CAT4', 'CAT5'];

export interface LigneTarifee {
  quantiteMilli: MilliUnites;
  prixUnitaireCentimes: Centimes;
  remisePourcent?: number;
  remiseCentimes?: Centimes;
  tauxTva: number;
}

export interface TotauxLigne {
  brutCentimes: Centimes;
  remiseCentimes: Centimes;
  netHtCentimes: Centimes;
  tvaCentimes: Centimes;
  netTtcCentimes: Centimes;
}

/**
 * Totaux d'une ligne. La remise en pourcentage et la remise en montant
 * peuvent coexister : le pourcentage s'applique d'abord.
 */
export function totauxLigne(ligne: LigneTarifee): TotauxLigne {
  const brut = arrondi((ligne.quantiteMilli * ligne.prixUnitaireCentimes) / 1000);
  const remisePct = ligne.remisePourcent ? pourcentageDe(brut, ligne.remisePourcent) : 0;
  const remise = Math.min(brut, remisePct + (ligne.remiseCentimes ?? 0));
  const netHt = brut - remise;
  const tva = pourcentageDe(netHt, ligne.tauxTva);
  return {
    brutCentimes: brut,
    remiseCentimes: remise,
    netHtCentimes: netHt,
    tvaCentimes: tva,
    netTtcCentimes: netHt + tva,
  };
}

/**
 * Parametrage du droit de timbre.
 *
 * En Algerie il s'applique aux reglements en especes. Le taux, le minimum
 * et le maximum sont parametrables par magasin : les valeurs par defaut
 * ci-dessous doivent etre confirmees avec le comptable du client
 * (section 8 du cahier des charges, "Conformite").
 */
export interface ParametrageTimbre {
  actif: boolean;
  tauxPourcent: number;
  minimumCentimes: Centimes;
  maximumCentimes: Centimes;
  /** Arrondi du timbre au multiple de N centimes (0 = pas d'arrondi). */
  arrondiCentimes: Centimes;
  /** Modes de paiement soumis au timbre. */
  modesSoumis: ModePaiement[];
}

export const TIMBRE_DEFAUT: ParametrageTimbre = {
  actif: false,
  tauxPourcent: 1,
  minimumCentimes: 500,
  maximumCentimes: 250000,
  arrondiCentimes: 100,
  modesSoumis: ['ESPECES'],
};

export type ModePaiement =
  | 'ESPECES'
  | 'CARTE'
  | 'CHEQUE'
  | 'CREDIT'
  | 'BON_ACHAT'
  | 'VIREMENT';

/**
 * Droit de timbre du par un document selon son montant TTC et les modes
 * de reglement utilises. Exoneration si aucun mode soumis n'est employe.
 */
export function calculerTimbre(
  montantTtcCentimes: Centimes,
  modesUtilises: ModePaiement[],
  parametrage: ParametrageTimbre = TIMBRE_DEFAUT,
): Centimes {
  if (!parametrage.actif) return 0;
  const concerne = modesUtilises.some((m) => parametrage.modesSoumis.includes(m));
  if (!concerne || montantTtcCentimes <= 0) return 0;

  let timbre = pourcentageDe(montantTtcCentimes, parametrage.tauxPourcent);
  timbre = Math.max(timbre, parametrage.minimumCentimes);
  timbre = Math.min(timbre, parametrage.maximumCentimes);
  if (parametrage.arrondiCentimes > 0) {
    timbre = Math.ceil(timbre / parametrage.arrondiCentimes) * parametrage.arrondiCentimes;
  }
  return timbre;
}

export interface TotauxDocument {
  brutCentimes: Centimes;
  remiseCentimes: Centimes;
  totalHtCentimes: Centimes;
  totalTvaCentimes: Centimes;
  timbreCentimes: Centimes;
  totalTtcCentimes: Centimes;
  /** Ventilation de la TVA par taux, pour les etats fiscaux (M12). */
  ventilationTva: Array<{ taux: number; baseCentimes: Centimes; tvaCentimes: Centimes }>;
}

/** Totaux d'un document (ticket, facture, bon de livraison). */
export function totauxDocument(
  lignes: LigneTarifee[],
  options: {
    remisePiedPourcent?: number;
    modesPaiement?: ModePaiement[];
    timbre?: ParametrageTimbre;
  } = {},
): TotauxDocument {
  const calculees = lignes.map((l) => ({ ligne: l, totaux: totauxLigne(l) }));

  const brut = somme(calculees.map((c) => c.totaux.brutCentimes));
  let remise = somme(calculees.map((c) => c.totaux.remiseCentimes));
  let totalHt = somme(calculees.map((c) => c.totaux.netHtCentimes));

  // Remise de pied de ticket : repartie au prorata pour garder une
  // ventilation de TVA exacte.
  const remisePied = options.remisePiedPourcent
    ? pourcentageDe(totalHt, options.remisePiedPourcent)
    : 0;

  const parTaux = new Map<number, { base: Centimes; tva: Centimes }>();
  let totalTva = 0;
  let htApresRemisePied = 0;
  let remisePiedRestante = remisePied;

  calculees.forEach((c, index) => {
    const part =
      index === calculees.length - 1
        ? remisePiedRestante
        : totalHt === 0
          ? 0
          : arrondi((c.totaux.netHtCentimes * remisePied) / totalHt);
    remisePiedRestante -= part;

    const baseLigne = c.totaux.netHtCentimes - part;
    const tvaLigne = pourcentageDe(baseLigne, c.ligne.tauxTva);
    htApresRemisePied += baseLigne;
    totalTva += tvaLigne;

    const courant = parTaux.get(c.ligne.tauxTva) ?? { base: 0, tva: 0 };
    courant.base += baseLigne;
    courant.tva += tvaLigne;
    parTaux.set(c.ligne.tauxTva, courant);
  });

  remise += remisePied;
  totalHt = htApresRemisePied;
  const ttcAvantTimbre = totalHt + totalTva;
  const timbre = calculerTimbre(ttcAvantTimbre, options.modesPaiement ?? [], options.timbre);

  return {
    brutCentimes: brut,
    remiseCentimes: remise,
    totalHtCentimes: totalHt,
    totalTvaCentimes: totalTva,
    timbreCentimes: timbre,
    totalTtcCentimes: ttcAvantTimbre + timbre,
    ventilationTva: [...parTaux.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([taux, v]) => ({ taux, baseCentimes: v.base, tvaCentimes: v.tva })),
  };
}
