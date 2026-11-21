import { formaterDA, formaterQuantite, type UniteMesure } from '@gestglobale/shared';

/**
 * Representation intermediaire d'un rapport.
 *
 * Les rapports sont rendus sous trois formes : JSON pour les ecrans,
 * Excel pour le comptable, PDF pour l'archive et l'impression. Les
 * decrire une seule fois ici evite que les trois divergent — c'est
 * exactement ce qui fait qu'un export Excel finit par ne plus
 * correspondre a l'ecran.
 */

export type Alignement = 'gauche' | 'droite';

export type Sorte =
  /** Texte brut. */
  | 'texte'
  /** Montant en centimes, rendu en dinars a deux decimales. */
  | 'montant'
  /** Quantite en milliemes, rendue selon les decimales de l'unite. */
  | 'quantite'
  /** Entier simple. */
  | 'nombre'
  /** Pourcentage entier. */
  | 'pourcent'
  /** Date, rendue en JJ/MM/AAAA. */
  | 'date'
  /** Date et heure. */
  | 'horodatage'
  /** Oui / non. */
  | 'booleen';

export interface Colonne {
  /** Clef de la donnee dans la ligne. */
  cle: string;
  titre: string;
  sorte?: Sorte;
  /** Largeur indicative, en caracteres, pour Excel et le PDF. */
  largeur?: number;
}

export interface Bloc {
  titre?: string;
  colonnes: Colonne[];
  lignes: Array<Record<string, unknown>>;
  /** Ligne de total, affichee en gras et non triee. */
  total?: Record<string, unknown>;
  /** Phrase affichee sous le bloc quand il est vide. */
  siVide?: string;
}

export interface Rapport {
  titre: string;
  /** Sous-titre : periode, magasin, date d'edition. */
  sousTitre?: string;
  /**
   * Chiffres mis en avant avant les tableaux. Le gerant doit pouvoir
   * lire l'essentiel sans parcourir les colonnes.
   */
  enTete?: Array<{ intitule: string; valeur: string }>;
  blocs: Bloc[];
  /**
   * Note de bas de page. Sert a dire ce qu'un chiffre ne dit pas : par
   * exemple qu'un ecart de caisse est en partie structurel.
   */
  note?: string;
}

/** Rend une cellule en texte, pour le PDF et pour l'affichage. */
export function cellule(valeur: unknown, sorte: Sorte = 'texte', unite?: unknown): string {
  // Une case sans valeur reste vide. Afficher « 0,00 » pour un montant
  // absent fait lire un chiffre la ou il n'y en a pas : sur une ligne de
  // total, cela annoncait zero pour des colonnes qu'on ne totalise pas.
  if (valeur === null || valeur === undefined || valeur === '') return '—';
  switch (sorte) {
    case 'montant':
      return formaterDA(Number(valeur), { devise: false });
    case 'quantite':
      // L'unite vient de la ligne quand elle y figure : 2 pieces ne
      // s'ecrivent pas comme 2,000 kg.
      return formaterQuantite(Number(valeur), (unite as UniteMesure) ?? 'UN');
    case 'nombre':
      return Number(valeur).toLocaleString('fr-FR');
    case 'pourcent':
      return `${Number(valeur)} %`;
    case 'date':
      return formaterJour(valeur);
    case 'horodatage':
      return `${formaterJour(valeur)} ${formaterHeure(valeur)}`;
    case 'booleen':
      return valeur ? 'oui' : 'non';
    default:
      return String(valeur);
  }
}

/** Les dates s'ecrivent JJ/MM/AAAA, comme l'exige la section 2. */
export function formaterJour(valeur: unknown): string {
  const d = valeur instanceof Date ? valeur : new Date(String(valeur));
  if (Number.isNaN(d.getTime())) return String(valeur);
  const jj = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${jj}/${mm}/${d.getFullYear()}`;
}

export function formaterHeure(valeur: unknown): string {
  const d = valeur instanceof Date ? valeur : new Date(String(valeur));
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
}

export function alignement(sorte: Sorte = 'texte'): Alignement {
  return sorte === 'montant' || sorte === 'quantite'
    || sorte === 'nombre' || sorte === 'pourcent'
    ? 'droite'
    : 'gauche';
}

/**
 * Nom de fichier propose au telechargement.
 *
 * Sans accent ni espace : ces fichiers transitent par des clefs USB et
 * des boites de courriel qui les deforment.
 */
export function nomDeFichier(titre: string, extension: string): string {
  const base = titre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  const maintenant = new Date();
  const horodatage = [
    maintenant.getFullYear(),
    String(maintenant.getMonth() + 1).padStart(2, '0'),
    String(maintenant.getDate()).padStart(2, '0'),
  ].join('');
  return `${base}-${horodatage}.${extension}`;
}
