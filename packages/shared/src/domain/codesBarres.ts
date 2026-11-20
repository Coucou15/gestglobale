/**
 * Codes-barres : controle EAN-13 et codes a poids ou prix variable.
 *
 * Les balances du magasin impriment des EAN-13 commencant par 2 ou le code
 * article et le poids (ou le prix) sont incorpores. Le format exact depend
 * du modele de balance : il est donc parametrable, pas code en dur.
 */

export type TypeValeurIncorporee = 'POIDS' | 'PRIX';

export interface RegleCodePoids {
  /** Prefixe du code (ex. "21", "22", "27"). */
  prefixe: string;
  /** Nombre de chiffres du code article qui suit le prefixe. */
  chiffresCode: number;
  /** Nombre de chiffres de la valeur incorporee. */
  chiffresValeur: number;
  /** Ce que porte la valeur : un poids ou un prix total. */
  typeValeur: TypeValeurIncorporee;
  /** Decimales de la valeur : 3 pour un poids en grammes, 2 pour un prix. */
  decimalesValeur: number;
  /** Le dernier chiffre de la valeur est-il une cle de controle a ignorer ? */
  cleDansValeur?: boolean;
}

/**
 * Regles par defaut, a confirmer avec les balances installees :
 * 2 + 6 chiffres de code + 5 chiffres de valeur + cle EAN.
 */
export const REGLES_POIDS_DEFAUT: RegleCodePoids[] = [
  { prefixe: '21', chiffresCode: 5, chiffresValeur: 5, typeValeur: 'POIDS', decimalesValeur: 3 },
  { prefixe: '22', chiffresCode: 5, chiffresValeur: 5, typeValeur: 'POIDS', decimalesValeur: 3 },
  { prefixe: '23', chiffresCode: 5, chiffresValeur: 5, typeValeur: 'POIDS', decimalesValeur: 3 },
  { prefixe: '24', chiffresCode: 5, chiffresValeur: 5, typeValeur: 'PRIX', decimalesValeur: 2 },
  { prefixe: '25', chiffresCode: 5, chiffresValeur: 5, typeValeur: 'PRIX', decimalesValeur: 2 },
  { prefixe: '26', chiffresCode: 5, chiffresValeur: 5, typeValeur: 'PRIX', decimalesValeur: 2 },
  { prefixe: '27', chiffresCode: 5, chiffresValeur: 5, typeValeur: 'PRIX', decimalesValeur: 2 },
];

/** Calcule la cle de controle d'un EAN-13 (12 chiffres en entree). */
export function cleEan13(douzeChiffres: string): number {
  if (!/^\d{12}$/.test(douzeChiffres)) {
    throw new Error('Le calcul de cle EAN-13 attend exactement 12 chiffres');
  }
  let total = 0;
  for (let i = 0; i < 12; i++) {
    total += Number(douzeChiffres[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (total % 10)) % 10;
}

export function ean13Valide(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return cleEan13(code.slice(0, 12)) === Number(code[12]);
}

/** Genere un EAN-13 interne a partir d'une base de 12 chiffres. */
export function genererEan13(base12: string): string {
  const base = base12.padStart(12, '0').slice(-12);
  return base + cleEan13(base);
}

export interface CodeScanne {
  /** Code a rechercher dans le catalogue. */
  codeRecherche: string;
  /** Poids lu sur l'etiquette, en milli-unites (KG), si present. */
  poidsMilli?: number;
  /** Prix total lu sur l'etiquette, en centimes, si present. */
  prixCentimes?: number;
  /** Vrai si le code vient d'une balance. */
  codePoids: boolean;
}

/**
 * Analyse un code scanne. Si c'est un code balance, extrait le code article
 * et la valeur incorporee ; sinon retourne le code tel quel.
 */
export function analyserCodeScanne(
  code: string,
  regles: RegleCodePoids[] = REGLES_POIDS_DEFAUT,
): CodeScanne {
  const propre = code.trim();
  if (/^\d{13}$/.test(propre)) {
    for (const regle of regles) {
      if (!propre.startsWith(regle.prefixe)) continue;
      const debutCode = regle.prefixe.length;
      const finCode = debutCode + regle.chiffresCode;
      const codeArticle = propre.slice(debutCode, finCode);
      const brute = propre.slice(finCode, finCode + regle.chiffresValeur);
      if (brute.length < regle.chiffresValeur) continue;
      const utile = regle.cleDansValeur ? brute.slice(0, -1) : brute;
      const valeur = Number(utile) / Math.pow(10, regle.decimalesValeur);
      if (regle.typeValeur === 'POIDS') {
        return {
          codeRecherche: codeArticle,
          poidsMilli: Math.round(valeur * 1000),
          codePoids: true,
        };
      }
      return {
        codeRecherche: codeArticle,
        prixCentimes: Math.round(valeur * 100),
        codePoids: true,
      };
    }
  }
  return { codeRecherche: propre, codePoids: false };
}
