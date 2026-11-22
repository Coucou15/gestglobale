import PDFDocument from 'pdfkit';
import { formaterDA, formaterQuantite, libelleModePaiement, type UniteMesure } from '@gestglobale/shared';
import { enToutesLettres, type DocumentImprimable } from './impression';
import type { MentionsLegales } from './documents.service';

/**
 * Document de vente en PDF, cote serveur (M5).
 *
 * La version HTML reste : elle sert a l'impression depuis le
 * back-office, ou le navigateur fait le travail. Ce rendu-ci existe
 * pour ce que le navigateur ne peut pas faire — joindre une facture a
 * un courriel sans qu'une personne clique quelque part.
 *
 * Les deux portent les memes mentions, dans le meme ordre. Une facture
 * dont le PDF differerait de l'impression serait pire qu'une absence de
 * PDF : le client et le comptable ne sauraient plus laquelle fait foi.
 *
 * Ecrit avec pdfkit, sans navigateur : installer Chromium sur le
 * ProLiant du client pour fabriquer une facture serait disproportionne.
 */

const LIBELLES: Record<string, string> = {
  FACTURE: 'Facture',
  BON_LIVRAISON: 'Bon de livraison',
  PROFORMA: 'Facture proforma',
  AVOIR: 'Avoir',
  RETOUR: 'Retour client',
  TICKET: 'Ticket de caisse',
};

const A4 = { largeur: 595, hauteur: 842 };
const MARGE = 40;
const LARGEUR = A4.largeur - 2 * MARGE;
const GRIS = '#555555';
const TRAIT = '#cccccc';

/** Colonnes du tableau des lignes, en points, sur la largeur utile. */
const COLONNES = [
  { titre: 'N°', largeur: 20, aligne: 'left' as const },
  { titre: 'Reference', largeur: 62, aligne: 'left' as const },
  { titre: 'Designation', largeur: 150, aligne: 'left' as const },
  { titre: 'Quantite', largeur: 50, aligne: 'right' as const },
  { titre: 'Unite', largeur: 32, aligne: 'left' as const },
  { titre: 'P.U. HT', largeur: 62, aligne: 'right' as const },
  { titre: 'Rem.', largeur: 32, aligne: 'right' as const },
  { titre: 'TVA', largeur: 30, aligne: 'right' as const },
  { titre: 'Total HT', largeur: 77, aligne: 'right' as const },
];

function jour(valeur: Date | string | null): string {
  if (!valeur) return '';
  const d = valeur instanceof Date ? valeur : new Date(valeur);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

type Pdf = PDFKit.PDFDocument;

export function composerDocumentPdf(document: DocumentImprimable): Promise<Buffer> {
  const mentions = (document.mentions ?? null) as MentionsLegales | null;
  const emetteur = mentions?.emetteur;
  const destinataire = mentions?.destinataire;
  const libelle = LIBELLES[document.type] ?? document.type;

  return new Promise((resoudre, rejeter) => {
    const doc = new PDFDocument({
      size: 'A4',
      // Les pages sont gardees en memoire pour pouvoir y revenir : le
      // numero de page et le rappel d'identite ne peuvent s'ecrire
      // qu'une fois le nombre total de pages connu.
      bufferPages: true,
      margins: { top: MARGE, bottom: MARGE, left: MARGE, right: MARGE },
      info: {
        Title: `${libelle} ${document.numero}`,
        Author: emetteur?.raisonSociale ?? 'GestGlobale',
      },
    });
    const morceaux: Buffer[] = [];
    doc.on('data', (m: Buffer) => morceaux.push(m));
    doc.on('end', () => resoudre(Buffer.concat(morceaux)));
    doc.on('error', rejeter);

    enTete(doc, document, libelle, emetteur);
    parties(doc, emetteur, destinataire);
    tableau(doc, document);
    bas(doc, document);
    marquesSpeciales(doc, document);
    pied(doc, document);
    rappelsDePage(doc, document, libelle, destinataire);
    if (document.statut === 'ANNULE') filigrane(doc, 'ANNULE');

    doc.end();
  });
}

function enTete(
  doc: Pdf,
  document: DocumentImprimable,
  libelle: string,
  emetteur: MentionsLegales['emetteur'] | undefined,
): void {
  const haut = doc.y;

  doc.font('Helvetica-Bold').fontSize(14)
    .text(emetteur?.raisonSociale ?? '', MARGE, haut, { width: LARGEUR * 0.55 });
  doc.font('Helvetica').fontSize(9).fillColor('#000');
  if (emetteur?.adresse) doc.text(emetteur.adresse, { width: LARGEUR * 0.55 });
  if (emetteur?.telephone) doc.text(`Tel. ${emetteur.telephone}`, { width: LARGEUR * 0.55 });

  // Identifiants fiscaux : ils doivent figurer sur toute facture.
  const identifiants = [
    emetteur?.rc ? `RC ${emetteur.rc}` : null,
    emetteur?.nif ? `NIF ${emetteur.nif}` : null,
    emetteur?.nis ? `NIS ${emetteur.nis}` : null,
    emetteur?.articleImposition ? `Art. imp. ${emetteur.articleImposition}` : null,
  ].filter(Boolean).join('   ');
  if (identifiants) {
    doc.fillColor(GRIS).fontSize(8).text(identifiants, { width: LARGEUR * 0.55 });
  }
  const basGauche = doc.y;

  // Bloc de droite : nature du document, numero, dates.
  const xDroite = MARGE + LARGEUR * 0.55;
  const largeurDroite = LARGEUR * 0.45;
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(20)
    .text(libelle.toUpperCase(), xDroite, haut, { width: largeurDroite, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(12)
    .text(document.numero, { width: largeurDroite, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(GRIS)
    .text(`Le ${jour(document.dateVente)}`, { width: largeurDroite, align: 'right' });
  if (document.dateEcheance) {
    doc.text(`Echeance : ${jour(document.dateEcheance)}`,
      { width: largeurDroite, align: 'right' });
  }
  if (document.documentSource) {
    doc.text(`D'apres ${document.documentSource.numero}`,
      { width: largeurDroite, align: 'right' });
  }

  doc.fillColor('#000');
  doc.y = Math.max(basGauche, doc.y) + 14;
  doc.x = MARGE;
}

function parties(
  doc: Pdf,
  emetteur: MentionsLegales['emetteur'] | undefined,
  destinataire: MentionsLegales['destinataire'] | undefined,
): void {
  const haut = doc.y;
  const largeur = (LARGEUR - 14) / 2;

  const bloc = (titre: string, partie: Record<string, unknown> | null | undefined, x: number) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS)
      .text(titre.toUpperCase(), x, haut, { width: largeur });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
      .text(String(partie?.raisonSociale ?? '—'), { width: largeur });
    doc.font('Helvetica').fontSize(9);
    for (const ligne of [
      partie?.adresse, partie?.telephone,
      partie?.rc ? `RC ${partie.rc}` : null,
      partie?.nif ? `NIF ${partie.nif}` : null,
    ]) {
      if (ligne) doc.text(String(ligne), { width: largeur });
    }
    return doc.y;
  };

  const basGauche = bloc('Emetteur', emetteur, MARGE);
  const basDroit = bloc('Client', destinataire, MARGE + largeur + 14);

  doc.y = Math.max(basGauche, basDroit) + 12;
  doc.x = MARGE;
}

/** Dessine l'entete du tableau et rend la hauteur de ligne. */
function enteteTableau(doc: Pdf): number {
  const hauteur = 16;
  const y = doc.y;
  doc.rect(MARGE, y, LARGEUR, hauteur).fill('#eeeeee').fillColor('#000');
  let x = MARGE;
  for (const colonne of COLONNES) {
    doc.font('Helvetica-Bold').fontSize(8)
      .text(colonne.titre, x + 3, y + 4.5, {
        width: colonne.largeur - 6, align: colonne.aligne, lineBreak: false,
      });
    x += colonne.largeur;
  }
  doc.y = y + hauteur;
  return hauteur;
}

function tableau(doc: Pdf, document: DocumentImprimable): void {
  enteteTableau(doc);

  for (const ligne of document.lignes) {
    const hauteurLigne = 15;
    // Place pour la ligne, plus de quoi ne pas laisser le bloc des
    // totaux seul sur la page suivante.
    if (doc.y > A4.hauteur - MARGE - 150) {
      doc.addPage();
      // De la place pour le rappel d'identite pose en fin de rendu.
      doc.y = MARGE + 6;
      enteteTableau(doc);
    }

    const y = doc.y;
    const valeurs = [
      String(ligne.numeroLigne),
      ligne.article.reference,
      ligne.designation,
      formaterQuantite(ligne.quantiteMilli, ligne.article.unite as UniteMesure),
      ligne.article.unite,
      formaterDA(ligne.prixUnitaireCentimes, { devise: false }),
      ligne.remisePourcent > 0 ? `${ligne.remisePourcent} %` : '',
      `${ligne.tauxTva} %`,
      formaterDA(ligne.totalHtCentimes, { devise: false }),
    ];

    let x = MARGE;
    COLONNES.forEach((colonne, i) => {
      doc.font('Helvetica').fontSize(8.5).fillColor('#000')
        .text(valeurs[i], x + 3, y + 4, {
          width: colonne.largeur - 6, align: colonne.aligne,
          lineBreak: false, ellipsis: true,
        });
      x += colonne.largeur;
    });

    doc.y = y + hauteurLigne;
    doc.moveTo(MARGE, doc.y).lineTo(MARGE + LARGEUR, doc.y)
      .lineWidth(0.3).strokeColor(TRAIT).stroke().strokeColor('#000');
  }

  doc.x = MARGE;
  doc.y += 12;
}

/**
 * Rappel d'identite en tete de chaque page suivante.
 *
 * Une facture de deux pages finit par etre separee dans un classeur.
 * Sans ce rappel, la seconde page ne dit ni de quelle facture il
 * s'agit, ni a qui elle s'adresse : elle ne vaut plus rien.
 */
/**
 * Filigrane en travers de la page.
 *
 * Pose a la fin, sur **toutes** les pages : un document annule doit se
 * voir d'un coup d'oeil, y compris sur la seconde feuille d'une facture
 * qu'on retrouve seule dans un classeur.
 *
 * La taille est mesuree plutot que devinee : un mot trop large pour la
 * diagonale sortait de la page et se retrouvait coupe.
 */
function filigrane(doc: Pdf, mot: string): void {
  const plage = doc.bufferedPageRange();
  const diagonale = Math.sqrt(A4.largeur ** 2 + A4.hauteur ** 2);

  for (let i = plage.start; i < plage.start + plage.count; i++) {
    doc.switchToPage(i);
    doc.save();
    doc.font('Helvetica-Bold');

    // On cherche la plus grande taille qui tienne sur 70 % de la
    // diagonale, en partant de 100 points.
    let taille = 100;
    while (taille > 20 && doc.fontSize(taille).widthOfString(mot) > diagonale * 0.7) {
      taille -= 4;
    }
    doc.fontSize(taille);

    const largeurMot = doc.widthOfString(mot);
    const hauteurMot = doc.currentLineHeight();
    // Les y croissent vers le bas : pour que le mot monte de gauche a
    // droite, comme un filigrane classique, l'angle doit etre negatif
    // dans ce repere, donc positif ici.
    const angle = (Math.atan2(A4.hauteur, A4.largeur) * 180) / Math.PI;

    doc.rotate(angle, { origin: [A4.largeur / 2, A4.hauteur / 2] });
    doc.fillColor('#dd3333').opacity(0.16).text(
      mot,
      A4.largeur / 2 - largeurMot / 2,
      A4.hauteur / 2 - hauteurMot / 2,
      { lineBreak: false },
    );
    doc.restore();
    doc.fillColor('#000').opacity(1);
  }
}

function rappelsDePage(
  doc: Pdf,
  document: DocumentImprimable,
  libelle: string,
  destinataire: MentionsLegales['destinataire'] | undefined,
): void {
  const plage = doc.bufferedPageRange();
  if (plage.count < 2) return;

  for (let i = plage.start; i < plage.start + plage.count; i++) {
    doc.switchToPage(i);
    const numeroPage = i - plage.start + 1;

    // La premiere page porte deja tout : elle n'a besoin que du compte.
    if (numeroPage > 1) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000')
        .text(`${libelle} ${document.numero}`, MARGE, MARGE - 22,
          { width: LARGEUR * 0.6, lineBreak: false });
      if (destinataire) {
        doc.font('Helvetica').fontSize(8).fillColor(GRIS)
          .text(destinataire.raisonSociale, MARGE, MARGE - 11,
            { width: LARGEUR * 0.6, lineBreak: false });
      }
    }

    doc.font('Helvetica').fontSize(8).fillColor(GRIS)
      .text(`Page ${numeroPage} / ${plage.count}`,
        MARGE + LARGEUR * 0.6, MARGE - 22,
        { width: LARGEUR * 0.4, align: 'right', lineBreak: false });
    doc.fillColor('#000');
  }
}

function bas(doc: Pdf, document: DocumentImprimable): void {
  const haut = doc.y;
  const largeurGauche = LARGEUR * 0.56;
  const largeurDroite = LARGEUR - largeurGauche - 10;
  const xDroite = MARGE + largeurGauche + 10;

  // Le montant en toutes lettres est exige sur une facture : c'est lui
  // qui fait foi si les chiffres sont contestes.
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS)
    .text('ARRETE LE PRESENT DOCUMENT A LA SOMME DE', MARGE, haut, { width: largeurGauche });
  doc.font('Helvetica').fontSize(10).fillColor('#000')
    .text(`${enToutesLettres(document.totalTtcCentimes)}.`, { width: largeurGauche });

  if (document.reglements.length > 0) {
    doc.moveDown(0.4);
    doc.fontSize(9).fillColor(GRIS).text(
      `Reglement : ${document.reglements
        .map((r) => `${libelleModePaiement(r.mode).toLowerCase()} ${formaterDA(r.montantCentimes)}`)
        .join(', ')}`,
      { width: largeurGauche },
    );
  }
  if (document.observation) {
    doc.moveDown(0.4);
    doc.fontSize(9).fillColor('#000').text(document.observation, { width: largeurGauche });
  }
  const basGauche = doc.y;

  // Totaux, cales a droite.
  const totaux: Array<[string, string, boolean]> = [
    ['Total brut', formaterDA(document.totalBrutCentimes), false],
    ...(document.totalRemiseCentimes > 0
      ? [['Remise', `-${formaterDA(document.totalRemiseCentimes)}`, false] as [string, string, boolean]]
      : []),
    ['Total HT', formaterDA(document.totalHtCentimes), false],
    ['TVA', formaterDA(document.totalTvaCentimes), false],
    ...(document.timbreCentimes > 0
      ? [['Droit de timbre', formaterDA(document.timbreCentimes), false] as [string, string, boolean]]
      : []),
    ['Net a payer', formaterDA(document.totalTtcCentimes), true],
  ];

  let y = haut;
  for (const [intitule, montant, fort] of totaux) {
    if (fort) {
      doc.rect(xDroite, y - 1, largeurDroite, 18).fill('#eeeeee').fillColor('#000');
    }
    doc.font(fort ? 'Helvetica-Bold' : 'Helvetica').fontSize(fort ? 11 : 9)
      .fillColor('#000')
      .text(intitule, xDroite + 4, y + (fort ? 3 : 1), {
        width: largeurDroite / 2, lineBreak: false,
      });
    doc.text(montant, xDroite + largeurDroite / 2, y + (fort ? 3 : 1), {
      width: largeurDroite / 2 - 4, align: 'right', lineBreak: false,
    });
    y += fort ? 20 : 14;
  }

  doc.x = MARGE;
  doc.y = Math.max(basGauche, y) + 10;
}

function marquesSpeciales(doc: Pdf, document: DocumentImprimable): void {
  if (document.type === 'PROFORMA') {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000')
      .text('Document non contractuel', MARGE, doc.y, { continued: true });
    doc.font('Helvetica')
      .text(' — cette proforma ne vaut ni facture ni livraison.');
    doc.moveDown(0.5);
  }

  if (document.brouillon) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#b36b00')
      .text('BROUILLON — ce document n’est pas encore valide.', MARGE, doc.y);
    doc.fillColor('#000').moveDown(0.5);
  }

  doc.x = MARGE;
}

function pied(doc: Pdf, document: DocumentImprimable): void {
  // Le cachet se signe a la main : on reserve la place plutot que de
  // laisser le signataire chercher ou ecrire.
  const yCachet = Math.max(doc.y + 10, A4.hauteur - MARGE - 70);
  const largeurCachet = 180;
  const xCachet = MARGE + LARGEUR - largeurCachet;
  doc.moveTo(xCachet, yCachet).lineTo(xCachet + largeurCachet, yCachet)
    .lineWidth(0.5).strokeColor('#888888').stroke().strokeColor('#000');
  doc.font('Helvetica').fontSize(8).fillColor(GRIS)
    .text('Cachet et signature', xCachet, yCachet + 4,
      { width: largeurCachet, align: 'center' });

  const yPied = A4.hauteur - MARGE - 14;
  doc.moveTo(MARGE, yPied - 6).lineTo(MARGE + LARGEUR, yPied - 6)
    .lineWidth(0.5).strokeColor(TRAIT).stroke().strokeColor('#000');
  doc.fontSize(8).fillColor(GRIS)
    .text(`Etabli par ${document.utilisateur.nom}`, MARGE, yPied,
      { width: LARGEUR / 2, lineBreak: false });
  doc.text('GestGlobale', MARGE + LARGEUR / 2, yPied,
    { width: LARGEUR / 2, align: 'right', lineBreak: false });
  doc.fillColor('#000');
}
