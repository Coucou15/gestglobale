import ExcelJS from 'exceljs';

/**
 * Lecture de l'export Excel de l'ancien logiciel (section 7).
 *
 * L'export compte 12 onglets dont les intitules de colonnes varient selon
 * les versions. On ne se fie donc jamais a la position d'une colonne :
 * chaque champ est retrouve par son intitule, parmi plusieurs variantes
 * acceptees, apres normalisation (accents, casse, espaces, ponctuation).
 */

export interface LigneBrute {
  /** Numero de ligne dans le classeur, pour pointer une anomalie. */
  numero: number;
  valeurs: Record<string, string>;
}

export interface OngletLu {
  nom: string;
  colonnes: string[];
  lignes: LigneBrute[];
  /** Lignes de fin de tableau ignorees (« NOMBRE ITEMS », totaux). */
  lignesIgnorees: number;
}

/** Normalise un intitule : sans accent, sans ponctuation, en minuscules. */
export function normaliserIntitule(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Convertit une cellule en texte.
 *
 * Les codes commencant par 0 sont conserves tels quels et jamais convertis
 * en nombre (section 7, nettoyage automatique) : « 00042 » doit rester
 * « 00042 », sans quoi il ne correspondrait plus a l'etiquette balance.
 */
export function celluleEnTexte(valeur: ExcelJS.CellValue): string {
  if (valeur === null || valeur === undefined) return '';
  if (typeof valeur === 'string') return valeur.trim();
  if (typeof valeur === 'number') return String(valeur);
  if (typeof valeur === 'boolean') return valeur ? '1' : '0';
  if (valeur instanceof Date) return valeur.toISOString();
  if (typeof valeur === 'object') {
    const objet = valeur as { richText?: Array<{ text: string }>; text?: string; result?: unknown };
    if (Array.isArray(objet.richText)) return objet.richText.map((m) => m.text).join('').trim();
    if (typeof objet.text === 'string') return objet.text.trim();
    if (objet.result !== undefined) return celluleEnTexte(objet.result as ExcelJS.CellValue);
  }
  return String(valeur).trim();
}

/** Repere une ligne de fin de tableau a ignorer. */
function ligneDeTotal(valeurs: Record<string, string>): boolean {
  const premiere = Object.values(valeurs).find((v) => v !== '') ?? '';
  const n = normaliserIntitule(premiere);
  return (
    n.startsWith('nombre_items') ||
    n.startsWith('nombre_d_items') ||
    n === 'total' ||
    n.startsWith('total_general')
  );
}

export async function lireClasseur(chemin: string): Promise<OngletLu[]> {
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.readFile(chemin);
  return lireClasseurCharge(classeur);
}

export async function lireTampon(tampon: Buffer): Promise<OngletLu[]> {
  const classeur = new ExcelJS.Workbook();
  // ExcelJS attend un ArrayBuffer ; on evite une copie inutile.
  await classeur.xlsx.load(tampon as unknown as ArrayBuffer);
  return lireClasseurCharge(classeur);
}

function lireClasseurCharge(classeur: ExcelJS.Workbook): OngletLu[] {
  const onglets: OngletLu[] = [];

  classeur.eachSheet((feuille) => {
    // La ligne d'entete n'est pas toujours la premiere : certains exports
    // ajoutent un titre ou une ligne vide. On prend la premiere ligne qui
    // porte au moins deux intitules non vides.
    let ligneEntete = 0;
    let colonnes: string[] = [];

    for (let i = 1; i <= Math.min(feuille.rowCount, 10); i++) {
      const brutes = (feuille.getRow(i).values as ExcelJS.CellValue[]) ?? [];
      const textes = brutes.slice(1).map(celluleEnTexte);
      if (textes.filter((t) => t !== '').length >= 2) {
        ligneEntete = i;
        colonnes = textes.map(normaliserIntitule);
        break;
      }
    }
    if (ligneEntete === 0) {
      onglets.push({ nom: feuille.name.trim(), colonnes: [], lignes: [], lignesIgnorees: 0 });
      return;
    }

    const lignes: LigneBrute[] = [];
    let ignorees = 0;

    for (let i = ligneEntete + 1; i <= feuille.rowCount; i++) {
      const brutes = (feuille.getRow(i).values as ExcelJS.CellValue[]) ?? [];
      const textes = brutes.slice(1).map(celluleEnTexte);
      if (textes.every((t) => t === '')) continue;

      const valeurs: Record<string, string> = {};
      colonnes.forEach((colonne, index) => {
        if (colonne) valeurs[colonne] = textes[index] ?? '';
      });

      if (ligneDeTotal(valeurs)) {
        ignorees++;
        continue;
      }
      lignes.push({ numero: i, valeurs });
    }

    onglets.push({
      nom: feuille.name.trim(),
      colonnes: colonnes.filter(Boolean),
      lignes,
      lignesIgnorees: ignorees,
    });
  });

  return onglets;
}

/** Retrouve une valeur parmi plusieurs intitules possibles. */
export function champ(
  ligne: LigneBrute,
  ...intitules: string[]
): string {
  for (const intitule of intitules) {
    const cle = normaliserIntitule(intitule);
    const valeur = ligne.valeurs[cle];
    if (valeur !== undefined && valeur !== '') return valeur;
  }
  return '';
}

/**
 * Nombre tolerant au format : virgule decimale, espaces insecables,
 * parentheses pour un negatif comptable.
 */
export function nombre(valeur: string): number | null {
  if (!valeur) return null;
  let v = valeur.replace(/[\s  ]/g, '').replace(',', '.');
  let signe = 1;
  if (/^\(.*\)$/.test(v)) {
    signe = -1;
    v = v.slice(1, -1);
  }
  const n = Number(v);
  return Number.isFinite(n) ? n * signe : null;
}

/**
 * Date tolerante. « 00/00/0000 » devient vide, conformement au nettoyage
 * automatique de la section 7.
 */
export function dateOuNull(valeur: string): Date | null {
  if (!valeur) return null;
  const nettoye = valeur.trim();
  if (/^0{1,2}[/\-]0{1,2}[/\-]0{2,4}$/.test(nettoye)) return null;

  const jma = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/.exec(nettoye);
  if (jma) {
    const jour = Number(jma[1]);
    const mois = Number(jma[2]);
    let annee = Number(jma[3]);
    if (annee < 100) annee += annee < 50 ? 2000 : 1900;
    if (jour === 0 || mois === 0) return null;
    const d = new Date(Date.UTC(annee, mois - 1, jour));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(nettoye);
  return Number.isNaN(d.getTime()) ? null : d;
}
