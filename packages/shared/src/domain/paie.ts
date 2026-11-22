import type { Centimes } from './money';
import { arrondi } from './money';

/**
 * Calcul d'un bulletin de paie (M13).
 *
 * **Les taux ne sont pas dans le code.** Cotisations sociales et impot
 * sur le revenu suivent un bareme passe en parametre, conserve ensuite
 * sur le bulletin : un bulletin de l'an dernier doit pouvoir etre
 * justifie avec les taux de l'an dernier, meme s'ils ont change depuis.
 *
 * Le bareme par defaut ci-dessous porte des valeurs plausibles pour
 * l'Algerie, mais elles **doivent etre validees par le comptable du
 * client** avant la premiere paie. Le cahier des charges le dit
 * explicitement, et ce module ne peut pas le deviner.
 */

export interface TrancheIrg {
  /** Borne haute de la tranche, en centimes. Nulle pour la derniere. */
  plafondCentimes: Centimes | null;
  /** Taux en pourcentage entier. */
  tauxPourcent: number;
}

export interface BaremePaie {
  /** Part salariale des cotisations sociales, en pourcentage. */
  cotisationSalarialePourcent: number;
  /** Part patronale : elle ne reduit pas le net, mais coute a l'employeur. */
  cotisationPatronalePourcent: number;
  /** Bareme progressif de l'impot sur le revenu, par tranches. */
  tranchesIrg: TrancheIrg[];
  /** Heures de travail par semaine prevues au contrat. */
  heuresParSemaine: number;
  /** Majoration des heures supplementaires, en pourcentage. */
  majorationHeureSupPourcent: number;
  /**
   * Un ecart de caisse peut-il etre retenu sur la paie ?
   *
   * Faux par defaut, et c'est important : retenir sur un salaire est un
   * acte grave, qui doit etre une decision explicite du client et non
   * un effet de bord du logiciel.
   */
  retenirEcartsDeCaisse: boolean;
  /** Primes exonerees de cotisations et d'impot (panier, transport). */
  primesExonerees: string[];
}

export const BAREME_PAIE_DEFAUT: BaremePaie = {
  cotisationSalarialePourcent: 9,
  cotisationPatronalePourcent: 26,
  tranchesIrg: [
    { plafondCentimes: 2000000, tauxPourcent: 0 },
    { plafondCentimes: 4000000, tauxPourcent: 20 },
    { plafondCentimes: 8000000, tauxPourcent: 30 },
    { plafondCentimes: null, tauxPourcent: 35 },
  ],
  heuresParSemaine: 40,
  majorationHeureSupPourcent: 50,
  retenirEcartsDeCaisse: false,
  primesExonerees: ['PANIER', 'TRANSPORT'],
};

export interface Prime {
  code: string;
  libelle: string;
  montantCentimes: Centimes;
}

export interface Retenue {
  libelle: string;
  montantCentimes: Centimes;
  /** D'ou vient la retenue : ABSENCE, AVANCE, ECART_CAISSE, AUTRE. */
  origine: string;
}

export interface EntreesBulletin {
  salaireBaseCentimes: Centimes;
  /** Heures effectivement travaillees sur le mois, depuis le pointage. */
  heuresTravaillees: number;
  /** Jours ouvrables du mois, pour proratiser une absence. */
  joursOuvrables: number;
  /** Jours d'absence non remuneree. */
  joursAbsenceNonPayee: number;
  primes: Prime[];
  /** Avances a rembourser sur cette paie. */
  avancesCentimes: Centimes;
  /** Ecarts de caisse de la periode, en valeur absolue. */
  ecartsDeCaisseCentimes: Centimes;
  /** Retenues saisies a la main par le gerant. */
  retenuesDiverses?: Retenue[];
}

export interface Bulletin {
  salaireBaseCentimes: Centimes;
  /** Part du salaire retiree pour absence non payee. */
  retenueAbsenceCentimes: Centimes;
  heuresSupplementaires: number;
  heuresSupCentimes: Centimes;
  primesCentimes: Centimes;
  primesExonereesCentimes: Centimes;
  brutCentimes: Centimes;
  /** Assiette des cotisations : le brut moins les primes exonerees. */
  assietteCotisableCentimes: Centimes;
  cotisationsCentimes: Centimes;
  cotisationsPatronalesCentimes: Centimes;
  /** Base de l'impot : assiette cotisable moins les cotisations. */
  baseImposableCentimes: Centimes;
  irgCentimes: Centimes;
  retenues: Retenue[];
  retenuesCentimes: Centimes;
  netAPayerCentimes: Centimes;
  /** Cout total pour l'employeur, cotisations patronales comprises. */
  coutEmployeurCentimes: Centimes;
}

/**
 * Heures mensuelles prevues au contrat.
 *
 * 52 semaines sur 12 mois : c'est la conversion usuelle, et elle evite
 * qu'un mois de cinq samedis paie des heures supplementaires fictives.
 */
export function heuresMensuellesPrevues(bareme: BaremePaie): number {
  return (bareme.heuresParSemaine * 52) / 12;
}

/** Heures au-dela de l'horaire prevu, jamais negatives. */
export function heuresSupplementaires(
  heuresTravaillees: number,
  bareme: BaremePaie,
): number {
  const prevues = heuresMensuellesPrevues(bareme);
  return Math.max(0, Math.round((heuresTravaillees - prevues) * 100) / 100);
}

/**
 * Impot sur le revenu, bareme progressif par tranches.
 *
 * Progressif veut dire que chaque tranche n'impose que la part du
 * revenu qui tombe dedans : un salaire qui franchit une tranche ne voit
 * pas tout son montant impose au taux superieur.
 */
export function calculerIrg(baseCentimes: Centimes, bareme: BaremePaie): Centimes {
  if (baseCentimes <= 0) return 0;

  let impot = 0;
  let precedent = 0;
  for (const tranche of bareme.tranchesIrg) {
    const plafond = tranche.plafondCentimes ?? Number.MAX_SAFE_INTEGER;
    if (baseCentimes <= precedent) break;
    const part = Math.min(baseCentimes, plafond) - precedent;
    if (part > 0) impot += (part * tranche.tauxPourcent) / 100;
    precedent = plafond;
  }
  return arrondi(impot);
}

/**
 * Compose un bulletin de paie.
 *
 * L'ordre des operations est celui d'un bulletin reel, et il n'est pas
 * indifferent : les cotisations portent sur le brut hors primes
 * exonerees, l'impot sur ce qui reste apres cotisations, et les
 * retenues viennent en dernier, sur le net. Les intervertir changerait
 * le montant verse.
 */
export function calculerBulletin(
  entrees: EntreesBulletin,
  bareme: BaremePaie = BAREME_PAIE_DEFAUT,
): Bulletin {
  const base = Math.max(0, entrees.salaireBaseCentimes);

  // Absence non payee : au prorata des jours ouvrables du mois.
  const retenueAbsence = entrees.joursOuvrables > 0 && entrees.joursAbsenceNonPayee > 0
    ? arrondi(
      (base * Math.min(entrees.joursAbsenceNonPayee, entrees.joursOuvrables))
        / entrees.joursOuvrables,
    )
    : 0;
  const baseApresAbsence = base - retenueAbsence;

  const heuresSup = heuresSupplementaires(entrees.heuresTravaillees, bareme);
  const tauxHoraire = heuresMensuellesPrevues(bareme) > 0
    ? base / heuresMensuellesPrevues(bareme)
    : 0;
  const heuresSupCentimes = arrondi(
    heuresSup * tauxHoraire * (1 + bareme.majorationHeureSupPourcent / 100),
  );

  const exonerees = new Set(bareme.primesExonerees.map((p) => p.toUpperCase()));
  let primesTotal = 0;
  let primesExonereesTotal = 0;
  for (const prime of entrees.primes) {
    primesTotal += prime.montantCentimes;
    if (exonerees.has(prime.code.toUpperCase())) {
      primesExonereesTotal += prime.montantCentimes;
    }
  }

  const brut = baseApresAbsence + heuresSupCentimes + primesTotal;
  const assiette = Math.max(0, brut - primesExonereesTotal);

  const cotisations = arrondi((assiette * bareme.cotisationSalarialePourcent) / 100);
  const cotisationsPatronales = arrondi(
    (assiette * bareme.cotisationPatronalePourcent) / 100,
  );
  const baseImposable = Math.max(0, assiette - cotisations);
  const irg = calculerIrg(baseImposable, bareme);

  const retenues: Retenue[] = [...(entrees.retenuesDiverses ?? [])];
  if (entrees.avancesCentimes > 0) {
    retenues.push({
      libelle: 'Avance sur salaire',
      montantCentimes: entrees.avancesCentimes,
      origine: 'AVANCE',
    });
  }
  // L'ecart de caisse ne se retient que si la regle interne le prevoit.
  // Par defaut il est signale au bulletin et pas preleve.
  if (bareme.retenirEcartsDeCaisse && entrees.ecartsDeCaisseCentimes > 0) {
    retenues.push({
      libelle: 'Ecart de caisse',
      montantCentimes: entrees.ecartsDeCaisseCentimes,
      origine: 'ECART_CAISSE',
    });
  }
  const retenuesTotal = retenues.reduce((t, r) => t + r.montantCentimes, 0);

  // Un salaire ne descend pas sous zero : si les retenues depassent ce
  // qui reste, le reliquat est reporte, jamais preleve d'avance.
  const netAvantRetenues = brut - cotisations - irg;
  const netAPayer = Math.max(0, netAvantRetenues - retenuesTotal);

  return {
    salaireBaseCentimes: base,
    retenueAbsenceCentimes: retenueAbsence,
    heuresSupplementaires: heuresSup,
    heuresSupCentimes,
    primesCentimes: primesTotal,
    primesExonereesCentimes: primesExonereesTotal,
    brutCentimes: brut,
    assietteCotisableCentimes: assiette,
    cotisationsCentimes: cotisations,
    cotisationsPatronalesCentimes: cotisationsPatronales,
    baseImposableCentimes: baseImposable,
    irgCentimes: irg,
    retenues,
    retenuesCentimes: retenuesTotal,
    netAPayerCentimes: netAPayer,
    coutEmployeurCentimes: brut + cotisationsPatronales,
  };
}

/**
 * Contrats qui arrivent a terme dans les trente jours (M13).
 *
 * Un CDI n'a pas de terme ; seuls un CDD et une periode d'essai en ont
 * un, et les laisser expirer sans decision est une faute que le
 * logiciel doit empecher.
 */
export function contratsAAlerter<T extends {
  type: string; fin: Date | string | null; actif: boolean;
}>(contrats: T[], maintenant = new Date(), jours = 30): Array<T & { joursRestants: number }> {
  const limite = new Date(maintenant.getTime() + jours * 86400000);
  return contrats
    .filter((c) => c.actif && c.fin !== null)
    .map((c) => {
      const fin = new Date(c.fin as string | Date);
      return {
        ...c,
        joursRestants: Math.ceil((fin.getTime() - maintenant.getTime()) / 86400000),
      };
    })
    .filter((c) => {
      const fin = new Date(c.fin as string | Date);
      return !Number.isNaN(fin.getTime()) && fin <= limite;
    })
    .sort((a, b) => a.joursRestants - b.joursRestants);
}
