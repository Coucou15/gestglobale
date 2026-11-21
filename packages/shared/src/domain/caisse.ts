import { Centimes, arrondi, somme } from './money';
import { ModePaiement } from './tarification';

/**
 * Cloture Z.
 *
 * L'export de l'ancien logiciel montre une recette physique a 0 et des
 * ecarts de -72 171 DA et -96 637 DA : le comptage n'etait pas saisi.
 * Ici le comptage par coupure est obligatoire et l'ecart est toujours
 * calcule puis justifie (objectif 6 du cahier des charges).
 */

/**
 * Coupures et pieces en circulation, en centimes.
 * Billets : 2000, 1000, 500, 200 DA. Pieces : 200, 100, 50, 20, 10, 5 DA.
 */
export const COUPURES_DA: Centimes[] = [
  200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000, 500,
];

export interface LigneComptage {
  /** Valeur de la coupure en centimes. */
  coupureCentimes: Centimes;
  nombre: number;
}

export interface ReglementTheorique {
  mode: ModePaiement;
  montantCentimes: Centimes;
}

export interface EntreeCloture {
  fondDeCaisseCentimes: Centimes;
  /** Totaux theoriques par mode, issus des tickets de la session. */
  theoriques: ReglementTheorique[];
  /** Comptage physique des especes, par coupure. */
  comptageEspeces: LigneComptage[];
  /** Sorties d'especes du tiroir pendant la session (achats comptant, depenses). */
  sortiesEspecesCentimes?: Centimes;
  /** Entrees d'especes hors vente (apport du gerant, remboursement). */
  entreesEspecesCentimes?: Centimes;
  /** Especes retirees vers le coffre avant comptage. */
  preleveeVersCoffreCentimes?: Centimes;
}

export interface ResultatCloture {
  theoriqueEspecesCentimes: Centimes;
  compteEspecesCentimes: Centimes;
  ecartEspecesCentimes: Centimes;
  totauxParMode: Array<{ mode: ModePaiement; montantCentimes: Centimes }>;
  recetteTotaleCentimes: Centimes;
  /** Vrai si un ecart existe : une justification devient obligatoire. */
  justificationRequise: boolean;
}

export function totalComptage(lignes: LigneComptage[]): Centimes {
  return somme(lignes.map((l) => arrondi(l.coupureCentimes) * Math.max(0, Math.trunc(l.nombre))));
}

/**
 * Calcule la cloture.
 *
 * Especes theoriques = fond de caisse + ventes especes + entrees diverses
 *                      - sorties de tiroir - prelevements vers le coffre.
 */
export function calculerCloture(entree: EntreeCloture): ResultatCloture {
  const ventesEspeces = somme(
    entree.theoriques.filter((t) => t.mode === 'ESPECES').map((t) => t.montantCentimes),
  );

  const theoriqueEspeces =
    entree.fondDeCaisseCentimes +
    ventesEspeces +
    (entree.entreesEspecesCentimes ?? 0) -
    (entree.sortiesEspecesCentimes ?? 0) -
    (entree.preleveeVersCoffreCentimes ?? 0);

  const compte = totalComptage(entree.comptageEspeces);
  const ecart = compte - theoriqueEspeces;

  const parMode = new Map<ModePaiement, Centimes>();
  for (const t of entree.theoriques) {
    parMode.set(t.mode, (parMode.get(t.mode) ?? 0) + arrondi(t.montantCentimes));
  }

  return {
    theoriqueEspecesCentimes: theoriqueEspeces,
    compteEspecesCentimes: compte,
    ecartEspecesCentimes: ecart,
    totauxParMode: [...parMode.entries()].map(([mode, montantCentimes]) => ({
      mode,
      montantCentimes,
    })),
    recetteTotaleCentimes: somme(entree.theoriques.map((t) => t.montantCentimes)),
    justificationRequise: ecart !== 0,
  };
}

/**
 * Numerotation des documents.
 *
 * Format impose par la section 4 : prefixe magasin et caisse, puis un
 * compteur local. Exemple : SV-03-000125. Le numero est attribue par la
 * caisse elle-meme, donc reste unique meme hors ligne.
 */
export function numeroDocument(params: {
  codeMagasin: string;
  numeroCaisse: number;
  compteur: number;
  longueurCompteur?: number;
}): string {
  const longueur = params.longueurCompteur ?? 6;
  const caisse = String(params.numeroCaisse).padStart(2, '0');
  const compteur = String(params.compteur).padStart(longueur, '0');
  return `${params.codeMagasin.toUpperCase()}-${caisse}-${compteur}`;
}

export function analyserNumeroDocument(numero: string): {
  codeMagasin: string;
  numeroCaisse: number;
  compteur: number;
} | null {
  const m = /^([A-Z0-9]+)-(\d{2,})-(\d+)$/.exec(numero.trim().toUpperCase());
  if (!m) return null;
  return { codeMagasin: m[1], numeroCaisse: Number(m[2]), compteur: Number(m[3]) };
}

/**
 * Nom lisible d'un mode de reglement.
 *
 * Le ticket imprime, le rapport du gerant et l'ecran de caisse doivent
 * nommer la meme chose de la meme facon : un gerant qui lit « A credit »
 * sur son rapport et « CREDIT » sur le ticket doute, a juste titre, de
 * lire la meme donnee.
 */
export function libelleModePaiement(mode: string): string {
  switch (mode) {
    case 'ESPECES': return 'Especes';
    case 'CARTE': return 'Carte (TPE)';
    case 'CHEQUE': return 'Cheque';
    case 'CREDIT': return 'A credit';
    case 'BON_ACHAT': return "Bon d'achat";
    case 'VIREMENT': return 'Virement';
    default: return mode;
  }
}
