import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import {
  alignement, cellule, formaterHeure, formaterJour,
  type Bloc, type Colonne, type Rapport, type Sorte,
} from './tableau';

/**
 * Rendu d'un rapport en Excel et en PDF (M9).
 *
 * Deux exigences differentes. L'Excel doit etre exploitable : les
 * montants y sont des nombres, pas du texte, sinon le comptable ne peut
 * ni sommer ni filtrer. Le PDF doit etre lisible et archivable : il est
 * imprime, signe, classe.
 */

/* ------------------------------------------------------------------ */
/* Excel                                                              */
/* ------------------------------------------------------------------ */

/** Format d'affichage des montants : 1 234,56 — sans devise dans la cellule. */
const FORMAT_MONTANT = '#,##0.00';
const FORMAT_NOMBRE = '#,##0';

/**
 * Valeur ecrite dans la cellule Excel.
 *
 * Les montants et les quantites y sont des nombres, pas du texte : sans
 * cela le comptable ne peut ni sommer ni filtrer, et l'export ne sert a
 * rien. En revanche une ligne de total porte un libelle — « Total » —
 * dans une colonne par ailleurs numerique ou datee : il faut le laisser
 * passer tel quel, sinon la ligne de total perd son nom.
 */
function valeurExcel(valeur: unknown, sorte: Sorte, unite?: unknown): unknown {
  if (valeur === null || valeur === undefined || valeur === '') return null;

  const nombre = (facteur: number): unknown => {
    const n = Number(valeur);
    return Number.isFinite(n) ? n / facteur : String(valeur);
  };

  switch (sorte) {
    case 'montant':
      // En dinars, pas en centimes : le comptable attend des dinars.
      return nombre(100);
    case 'quantite':
      return nombre(1000);
    case 'nombre':
    case 'pourcent':
      return nombre(1);
    case 'date':
    case 'horodatage': {
      const d = valeur instanceof Date ? valeur : new Date(String(valeur));
      return Number.isNaN(d.getTime()) ? String(valeur) : d;
    }
    case 'booleen':
      return valeur ? 'oui' : 'non';
    default:
      return cellule(valeur, sorte, unite);
  }
}

function formatExcel(sorte: Sorte): string | undefined {
  switch (sorte) {
    case 'montant': return FORMAT_MONTANT;
    case 'quantite': return '#,##0.000';
    case 'nombre': return FORMAT_NOMBRE;
    case 'date': return 'dd/mm/yyyy';
    case 'horodatage': return 'dd/mm/yyyy hh:mm';
    default: return undefined;
  }
}

/** Un onglet par bloc : le comptable travaille onglet par onglet. */
export async function enExcel(rapport: Rapport): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();
  classeur.creator = 'GestGlobale';
  classeur.created = new Date();

  // Premier onglet : l'essentiel, sans avoir a lire les colonnes.
  if (rapport.enTete && rapport.enTete.length > 0) {
    const resume = classeur.addWorksheet('Resume');
    resume.columns = [{ width: 38 }, { width: 22 }];
    resume.addRow([rapport.titre]).font = { bold: true, size: 14 };
    if (rapport.sousTitre) resume.addRow([rapport.sousTitre]).font = { italic: true };
    resume.addRow([]);
    for (const { intitule, valeur } of rapport.enTete) {
      const ligne = resume.addRow([intitule, valeur]);
      ligne.getCell(1).font = { bold: true };
    }
    if (rapport.note) {
      resume.addRow([]);
      resume.addRow([rapport.note]).font = { italic: true, size: 9 };
    }
  }

  rapport.blocs.forEach((bloc, index) => {
    const feuille = classeur.addWorksheet(nomOnglet(bloc.titre ?? rapport.titre, index));
    feuille.columns = bloc.colonnes.map((col: Colonne) => ({
      header: col.titre,
      key: col.cle,
      width: col.largeur ?? Math.max(12, col.titre.length + 2),
    }));

    const entete = feuille.getRow(1);
    entete.font = { bold: true };
    entete.alignment = { vertical: 'middle' };
    // Fige l'entete : sur 500 lignes, on perd sinon le nom des colonnes.
    feuille.views = [{ state: 'frozen', ySplit: 1 }];

    for (const source of bloc.lignes) {
      const valeurs: Record<string, unknown> = {};
      for (const col of bloc.colonnes) {
        valeurs[col.cle] = valeurExcel(source[col.cle], col.sorte ?? 'texte', source.unite);
      }
      const ligne = feuille.addRow(valeurs);
      bloc.colonnes.forEach((col, i) => {
        const format = formatExcel(col.sorte ?? 'texte');
        const c = ligne.getCell(i + 1);
        if (format) c.numFmt = format;
        c.alignment = { horizontal: alignement(col.sorte) === 'droite' ? 'right' : 'left' };
      });
    }

    if (bloc.total) {
      const valeurs: Record<string, unknown> = {};
      for (const col of bloc.colonnes) {
        valeurs[col.cle] = valeurExcel(bloc.total[col.cle], col.sorte ?? 'texte');
      }
      const ligne = feuille.addRow(valeurs);
      ligne.font = { bold: true };
      bloc.colonnes.forEach((col, i) => {
        const format = formatExcel(col.sorte ?? 'texte');
        if (format) ligne.getCell(i + 1).numFmt = format;
      });
    }

    if (bloc.lignes.length > 0) {
      feuille.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: bloc.colonnes.length },
      };
    }
  });

  const buffer = await classeur.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Nom d'onglet accepte par Excel : 31 caracteres au plus, et sans
 * : \ / ? * [ ]. Un nom invalide fait echouer l'ouverture du fichier,
 * pas seulement l'affichage de l'onglet.
 */
function nomOnglet(titre: string, index: number): string {
  const propre = titre
    .replace(/[:\\/?*[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28);
  return propre.length > 0 ? `${propre}` : `Feuille ${index + 1}`;
}

/* ------------------------------------------------------------------ */
/* PDF                                                                */
/* ------------------------------------------------------------------ */

const MARGE = 36;
const A4_PAYSAGE = { largeur: 842, hauteur: 595 };
const A4_PORTRAIT = { largeur: 595, hauteur: 842 };

/**
 * PDF A4 paysage.
 *
 * Le paysage n'est pas un detail : le journal des remises a dix
 * colonnes, et en portrait elles deviennent illisibles. pdfkit est
 * prefere a un rendu par navigateur parce que le serveur du client est
 * un ProLiant ML330 G6 sous Windows Server : y installer et y faire
 * tourner Chromium pour fabriquer un PDF serait disproportionne.
 */
export function enPdf(
  rapport: Rapport,
  options: { orientation?: 'paysage' | 'portrait' } = {},
): Promise<Buffer> {
  // Le portrait sert aux pieces qu'on remet a une personne — bulletin de
  // paie, attestation : on les plie et on les classe, elles ne sont pas
  // faites pour un tableau de dix colonnes.
  const portrait = options.orientation === 'portrait';
  const page = portrait ? A4_PORTRAIT : A4_PAYSAGE;

  return new Promise((resoudre, rejeter) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: portrait ? 'portrait' : 'landscape',
      margins: { top: MARGE, bottom: MARGE, left: MARGE, right: MARGE },
      info: { Title: rapport.titre, Author: 'GestGlobale' },
    });

    const morceaux: Buffer[] = [];
    doc.on('data', (m: Buffer) => morceaux.push(m));
    doc.on('end', () => resoudre(Buffer.concat(morceaux)));
    doc.on('error', rejeter);

    const largeurUtile = page.largeur - 2 * MARGE;

    /**
     * Ramene le curseur a la marge gauche.
     *
     * pdfkit ecrit a la position courante, et dessiner un tableau laisse
     * doc.x sur la derniere colonne. Sans cette remise, chaque titre de
     * bloc derivait un peu plus vers la droite et la note finissait
     * tronquee hors de la page.
     */
    const aLaMarge = () => { doc.x = MARGE; };

    doc.font('Helvetica-Bold').fontSize(16).text(rapport.titre, MARGE, doc.y, {
      width: largeurUtile, align: 'left',
    });
    if (rapport.sousTitre) {
      aLaMarge();
      doc.font('Helvetica').fontSize(10).fillColor('#555')
        .text(rapport.sousTitre, { width: largeurUtile }).fillColor('#000');
    }
    aLaMarge();
    doc.font('Helvetica').fontSize(8).fillColor('#777')
      .text(`Edite le ${formaterJour(new Date())} par GestGlobale`, { width: largeurUtile })
      .fillColor('#000');
    doc.moveDown(0.8);

    if (rapport.enTete && rapport.enTete.length > 0) {
      const parLigne = portrait ? 2 : 4;
      const largeurCase = largeurUtile / parLigne;
      for (let i = 0; i < rapport.enTete.length; i += parLigne) {
        const tranche = rapport.enTete.slice(i, i + parLigne);
        const y = doc.y;
        tranche.forEach((e, j) => {
          const x = MARGE + j * largeurCase;
          doc.font('Helvetica').fontSize(8).fillColor('#666')
            .text(e.intitule, x, y, { width: largeurCase - 8 });
          doc.font('Helvetica-Bold').fontSize(12).fillColor('#000')
            .text(e.valeur, x, y + 10, { width: largeurCase - 8 });
        });
        doc.y = y + 30;
      }
      aLaMarge();
      doc.moveDown(0.3);
    }

    for (const bloc of rapport.blocs) {
      dessinerBloc(doc, bloc, largeurUtile, page.hauteur);
      aLaMarge();
      doc.moveDown(0.8);
    }

    if (rapport.note) {
      aLaMarge();
      doc.font('Helvetica-Oblique').fontSize(8);
      // Mesurer plutot que deviner : une marge forfaitaire envoyait la
      // note seule sur une page vierge alors que la place restait.
      const hauteurNote = doc.heightOfString(rapport.note, { width: largeurUtile });
      if (doc.y + hauteurNote > page.hauteur - MARGE) doc.addPage();
      doc.fillColor('#555')
        .text(rapport.note, MARGE, doc.y, { width: largeurUtile })
        .fillColor('#000');
    }

    doc.end();
  });
}

type Pdf = PDFKit.PDFDocument;

function dessinerBloc(
  doc: Pdf, bloc: Bloc, largeurUtile: number, hauteurPage = A4_PAYSAGE.hauteur,
): void {
  if (bloc.titre) {
    if (doc.y > hauteurPage - MARGE - 60) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11)
      .text(bloc.titre, MARGE, doc.y, { width: largeurUtile });
    doc.moveDown(0.3);
  }

  if (bloc.lignes.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#666')
      .text(bloc.siVide ?? 'Aucune donnee sur cette periode.', MARGE, doc.y,
        { width: largeurUtile })
      .fillColor('#000');
    doc.x = MARGE;
    return;
  }

  // Largeurs proportionnelles aux largeurs indicatives des colonnes.
  const poids = bloc.colonnes.map((col) => col.largeur ?? Math.max(10, col.titre.length + 2));
  const sommePoids = poids.reduce((t, p) => t + p, 0);
  const largeurs = poids.map((p) => (p / sommePoids) * largeurUtile);

  const hauteurLigne = 14;
  const dessinerEntete = () => {
    const y = doc.y;
    doc.rect(MARGE, y - 2, largeurUtile, hauteurLigne).fill('#f0f0f0').fillColor('#000');
    let x = MARGE;
    bloc.colonnes.forEach((col, i) => {
      doc.font('Helvetica-Bold').fontSize(8).text(col.titre, x + 3, y + 1, {
        width: largeurs[i] - 6,
        align: alignement(col.sorte) === 'droite' ? 'right' : 'left',
        lineBreak: false,
      });
      x += largeurs[i];
    });
    doc.y = y + hauteurLigne;
  };

  dessinerEntete();

  const ecrireLigne = (source: Record<string, unknown>, gras: boolean) => {
    if (doc.y > hauteurPage - MARGE - hauteurLigne) {
      doc.addPage();
      dessinerEntete();
    }
    const y = doc.y;
    let x = MARGE;
    bloc.colonnes.forEach((col, i) => {
      const texte = cellule(source[col.cle], col.sorte ?? 'texte', source.unite);
      doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
        .text(texte, x + 3, y + 1, {
          width: largeurs[i] - 6,
          align: alignement(col.sorte) === 'droite' ? 'right' : 'left',
          lineBreak: false,
          ellipsis: true,
        });
      x += largeurs[i];
    });
    doc.y = y + hauteurLigne;
    doc.moveTo(MARGE, doc.y - 1).lineTo(MARGE + largeurUtile, doc.y - 1)
      .lineWidth(0.3).strokeColor('#dddddd').stroke().strokeColor('#000');
  };

  for (const ligne of bloc.lignes) ecrireLigne(ligne, false);
  if (bloc.total) ecrireLigne(bloc.total, true);
}

/* ------------------------------------------------------------------ */
/* CSV                                                                */
/* ------------------------------------------------------------------ */

export interface OptionsCsv {
  /**
   * Separateur de colonnes. Le point-virgule par defaut : Excel en
   * version francaise lit la virgule comme un separateur decimal, et
   * un fichier a virgules s'y ouvre sur une seule colonne.
   */
  separateur?: ';' | ',' | '\t';
  /**
   * Marque d'ordre des octets. Sans elle, Excel sous Windows lit un
   * fichier UTF-8 en ANSI et affiche « Superette » au lieu de
   * « Supérette ». Avec elle, il reconnait l'encodage seul.
   */
  bom?: boolean;
  /** Decimale des montants. La virgule en francais. */
  decimale?: ',' | '.';
}

const CSV_DEFAUT: Required<OptionsCsv> = { separateur: ';', bom: true, decimale: ',' };

/**
 * Rendu CSV d'un rapport (M12).
 *
 * Un seul fichier plat, parce que c'est ce qu'un logiciel de
 * comptabilite sait avaler. Quand le rapport a plusieurs blocs, ils se
 * suivent, separes par une ligne vide et precedes de leur titre : le
 * comptable retrouve ses tableaux, et un import automatique peut couper
 * sur les lignes vides.
 *
 * Le format exact attendu par le comptable du client n'etant pas connu,
 * le separateur, la decimale et la marque d'encodage sont des reglages,
 * pas des constantes.
 */
export function enCsv(rapport: Rapport, options: OptionsCsv = {}): Buffer {
  const reglages = { ...CSV_DEFAUT, ...options };
  const lignes: string[] = [];

  const echapper = (valeur: string): string => {
    // Guillemets, separateur et retours a la ligne obligent a encadrer
    // la valeur ; un guillemet interne se double.
    if (
      valeur.includes(reglages.separateur)
      || valeur.includes('"')
      || valeur.includes('\n')
      || valeur.includes('\r')
    ) {
      return `"${valeur.replace(/"/g, '""')}"`;
    }
    return valeur;
  };

  const nombreCsv = (valeur: unknown, facteur: number): string => {
    const n = Number(valeur);
    if (!Number.isFinite(n)) return '';
    const texte = (n / facteur).toFixed(facteur === 1000 ? 3 : 2);
    return reglages.decimale === ',' ? texte.replace('.', ',') : texte;
  };

  const valeurCsv = (valeur: unknown, sorte: Sorte, unite?: unknown): string => {
    if (valeur === null || valeur === undefined || valeur === '') return '';
    switch (sorte) {
      // Les montants partent en dinars, sans separateur de milliers :
      // un espace insecable entre les chiffres casse tout import.
      case 'montant': return nombreCsv(valeur, 100);
      case 'quantite': return nombreCsv(valeur, 1000);
      case 'nombre':
      case 'pourcent': return String(Number(valeur));
      case 'date': return formaterJour(valeur);
      case 'horodatage': return `${formaterJour(valeur)} ${formaterHeure(valeur)}`;
      case 'booleen': return valeur ? 'oui' : 'non';
      default: return cellule(valeur, sorte, unite);
    }
  };

  lignes.push(echapper(rapport.titre));
  if (rapport.sousTitre) lignes.push(echapper(rapport.sousTitre));
  for (const e of rapport.enTete ?? []) {
    // Les chiffres mis en avant sont deja formates pour l'ecran, avec
    // leurs separateurs de milliers — des espaces fines insecables que
    // ni un tableur ni un import ne savent relire comme un nombre. On
    // les retire : le fichier reste lisible, et ses valeurs restent des
    // valeurs.
    lignes.push([
      echapper(e.intitule),
      echapper(e.valeur.replace(/[\u202f\u00a0\u2009]/g, '')),
    ].join(reglages.separateur));
  }

  for (const bloc of rapport.blocs) {
    lignes.push('');
    if (bloc.titre) lignes.push(echapper(bloc.titre));
    lignes.push(bloc.colonnes.map((col) => echapper(col.titre)).join(reglages.separateur));

    for (const source of bloc.lignes) {
      lignes.push(bloc.colonnes
        .map((col) => echapper(valeurCsv(source[col.cle], col.sorte ?? 'texte', source.unite)))
        .join(reglages.separateur));
    }
    if (bloc.total) {
      lignes.push(bloc.colonnes
        .map((col) => echapper(valeurCsv(bloc.total![col.cle], col.sorte ?? 'texte')))
        .join(reglages.separateur));
    }
  }

  if (rapport.note) {
    lignes.push('');
    lignes.push(echapper(rapport.note.replace(/[\u202f\u00a0\u2009]/g, ' ')));
  }

  // Fins de ligne Windows : le poste du comptable est sous Windows, et
  // un fichier en \n s'y affiche parfois sur une seule ligne.
  const texte = lignes.join('\r\n') + '\r\n';
  return Buffer.from((reglages.bom ? '﻿' : '') + texte, 'utf8');
}
