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

/**
 * Formats qu'un fichier nomme « .xls » peut reellement cacher.
 *
 * L'extension ne dit rien : beaucoup de logiciels de gestion anciens
 * ecrivent un tableau HTML ou un texte tabule et le nomment « .xls »,
 * parce qu'Excel les ouvre quand meme. Un vrai .xls, lui, est un fichier
 * composite OLE2 des annees 1990.
 */
export type FormatClasseur =
  | 'XLSX'            // ZIP OpenXML, le format moderne
  | 'XLS_BIFF'        // vrai .xls binaire (OLE2)
  | 'HTML'            // tableau HTML renomme en .xls
  | 'SPREADSHEETML'   // XML Excel 2003
  | 'TEXTE'           // CSV ou texte tabule
  | 'INCONNU';

/** Reconnait le format par le contenu, jamais par l'extension. */
export function detecterFormat(tampon: Buffer): FormatClasseur {
  if (tampon.length < 8) return 'INCONNU';

  // ZIP : "PK\x03\x04"
  if (tampon[0] === 0x50 && tampon[1] === 0x4b && tampon[2] === 0x03 && tampon[3] === 0x04) {
    return 'XLSX';
  }
  // OLE2 : D0 CF 11 E0 A1 B1 1A E1
  if (
    tampon[0] === 0xd0 && tampon[1] === 0xcf && tampon[2] === 0x11 && tampon[3] === 0xe0 &&
    tampon[4] === 0xa1 && tampon[5] === 0xb1 && tampon[6] === 0x1a && tampon[7] === 0xe1
  ) {
    return 'XLS_BIFF';
  }

  const debut = tampon.subarray(0, 4096).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  const minuscules = debut.toLowerCase();

  if (minuscules.startsWith('<?xml')) {
    return /urn:schemas-microsoft-com:office:spreadsheet|<workbook/i.test(debut)
      ? 'SPREADSHEETML'
      : 'INCONNU';
  }
  if (
    minuscules.startsWith('<html') ||
    minuscules.startsWith('<!doctype html') ||
    minuscules.startsWith('<table') ||
    minuscules.startsWith('<meta')
  ) {
    return 'HTML';
  }
  // Du texte imprimable avec des separateurs de colonnes.
  if (/^[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]+$/.test(debut) && /[;,\t]/.test(debut)) {
    return 'TEXTE';
  }
  return 'INCONNU';
}

/** Erreur portant un message directement utilisable par le gerant. */
export class FormatNonGere extends Error {
  constructor(
    public readonly format: FormatClasseur,
    message: string,
  ) {
    super(message);
    this.name = 'FormatNonGere';
  }
}

const CONVERSION =
  'Ouvrez-le dans Excel ou LibreOffice, puis « Enregistrer sous » en ' +
  '« Classeur Excel (.xlsx) », et relancez l\u2019import. La conversion ne se ' +
  'fait qu\u2019une fois, a la bascule.';

export async function lireClasseur(chemin: string): Promise<OngletLu[]> {
  const { readFile } = await import('node:fs/promises');
  return lireTampon(await readFile(chemin));
}

export async function lireTampon(tampon: Buffer): Promise<OngletLu[]> {
  const format = detecterFormat(tampon);

  switch (format) {
    case 'XLSX': {
      const classeur = new ExcelJS.Workbook();
      // ExcelJS attend un ArrayBuffer ; on evite une copie inutile.
      await classeur.xlsx.load(tampon as unknown as ArrayBuffer);
      return lireClasseurCharge(classeur);
    }

    case 'TEXTE': {
      // Un export en un seul tableau : CSV ou texte tabule. On le traite
      // comme un classeur a un onglet, nomme d'apres son contenu.
      const classeur = new ExcelJS.Workbook();
      const { Readable } = await import('node:stream');
      const flux = Readable.from([tampon]);
      const feuille = await classeur.csv.read(flux, {
        parserOptions: { delimiter: devinerSeparateur(tampon) },
      });
      feuille.name = feuille.name || 'DONNEES';
      return lireClasseurCharge(classeur);
    }

    case 'XLS_BIFF':
      throw new FormatNonGere(
        format,
        `Ce fichier est un classeur Excel ancien (format binaire .xls d\u2019avant 2007). ` +
          CONVERSION,
      );

    case 'HTML':
      throw new FormatNonGere(
        format,
        `Ce fichier porte l\u2019extension .xls mais contient en realite un tableau HTML : ` +
          `c\u2019est ainsi que beaucoup de logiciels anciens « exportent vers Excel ». ` +
          CONVERSION,
      );

    case 'SPREADSHEETML':
      throw new FormatNonGere(
        format,
        `Ce fichier est au format XML Excel 2003, et non un classeur .xlsx. ` + CONVERSION,
      );

    default:
      throw new FormatNonGere(
        format,
        `Format de fichier non reconnu. L\u2019assistant attend un classeur Excel ` +
          `(.xlsx) ou un fichier texte (.csv). ` + CONVERSION,
      );
  }
}

/** Devine le separateur d'un fichier texte : point-virgule, virgule ou tabulation. */
function devinerSeparateur(tampon: Buffer): string {
  const echantillon = tampon.subarray(0, 8192).toString('utf8');
  const premiereLigne = echantillon.split(/\r?\n/)[0] ?? '';
  const comptes: Array<[string, number]> = [
    [';', (premiereLigne.match(/;/g) ?? []).length],
    ['\t', (premiereLigne.match(/\t/g) ?? []).length],
    [',', (premiereLigne.match(/,/g) ?? []).length],
  ];
  comptes.sort((a, b) => b[1] - a[1]);
  return comptes[0][1] > 0 ? comptes[0][0] : ';';
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
