import { describe, it, expect, beforeAll } from 'vitest';
import ExcelJS from 'exceljs';
import { ImportService } from '../src/import/import.service';
import {
  normaliserIntitule, nombre, dateOuNull, celluleEnTexte, detecterFormat, lireTampon,
} from '../src/import/lecture';

/**
 * Nettoyage automatique pendant l'import (section 7).
 *
 * Le classeur fabrique ici reproduit exactement les defauts decrits dans
 * le cahier des charges : unites aberrantes (« . », « + », « 28272 »),
 * lignes « NOMBRE ITEMS » en fin d'onglet, dates « 00/00/0000 », seuils
 * negatifs, codes-barres en doublon, codes commencant par 0.
 */

// L'analyse ne touche pas la base : les dependances ne servent qu'a
// l'enregistrement de la session, qui n'est pas appele ici.
const service = new ImportService(null as never, null as never);

async function classeurDeTest(): Promise<Buffer> {
  const classeur = new ExcelJS.Workbook();

  const produits = classeur.addWorksheet('PRODUITS');
  produits.addRow([
    'REFERENCE', 'DESIGNATION', 'UNITE', 'RAYON', 'FAMILLE',
    'STOCK ACTUEL (MC)', 'STOCK ACTUEL (SV)', 'SEUIL',
    'CUMP', 'DERNIER PRIX ACHAT', 'PRIX DETAIL', 'PRIX GROS', 'TVA', 'CODE BARRE',
  ]);
  // Article normal.
  produits.addRow(['ART001', 'Huile 5 L', 'U', 'EPI', 'HUI', 120, 24, 20, 620, 625, 750, 690, 0, '6130000000017']);
  // Unite « K » a convertir en KG.
  produits.addRow(['ART002', 'Pommes de terre', 'K', 'FRA', 'FRU', 500, 120, 50, 65, 66, 90, 85, 0, '']);
  // Unite en grammes : la quantite doit etre convertie en KG.
  produits.addRow(['ART003', 'Safran', 'GR', 'EPI', 'HUI', 2000, 500, 0, 2, 2, 5, 4, 0, '']);
  // Unites aberrantes de l'export.
  produits.addRow(['ART004', 'Article douteux 1', '.', 'EPI', 'HUI', 3, 1, 0, 100, 100, 150, 0, 0, '']);
  produits.addRow(['ART005', 'Article douteux 2', '+', 'EPI', 'HUI', 1, 0, 0, 100, 100, 150, 0, 0, '']);
  produits.addRow(['ART006', 'Article douteux 3', '28272', 'EPI', 'HUI', 0, 0, 0, 0, 0, 0, 0, 0, '']);
  // Seuil d'alerte negatif, a remettre a 0.
  produits.addRow(['ART007', 'Seuil negatif', 'U', 'EPI', 'HUI', 10, 5, -3, 100, 100, 150, 0, 0, '']);
  // Stock negatif, a corriger par inventaire.
  produits.addRow(['ART008', 'Stock negatif', 'U', 'EPI', 'HUI', -4, -2, 0, 100, 100, 150, 0, 0, '']);
  // Vente a perte : prix de vente sous le CUMP.
  produits.addRow(['ART009', 'Vendu a perte', 'U', 'EPI', 'HUI', 10, 5, 0, 200, 200, 150, 0, 0, '']);
  // Code-barres en doublon avec ART001.
  produits.addRow(['ART010', 'Doublon de code', 'U', 'EPI', 'HUI', 5, 2, 0, 100, 100, 150, 0, 0, '6130000000017']);
  // Reference en doublon : la seconde est ignoree.
  produits.addRow(['ART001', 'Huile 5 L (doublon)', 'U', 'EPI', 'HUI', 1, 1, 0, 620, 625, 750, 0, 0, '']);
  // Ligne sans reference.
  produits.addRow(['', 'Sans reference', 'U', 'EPI', 'HUI', 1, 1, 0, 10, 10, 20, 0, 0, '']);
  // Cle EAN-13 fausse.
  produits.addRow(['ART011', 'EAN faux', 'U', 'EPI', 'HUI', 1, 1, 0, 10, 10, 20, 0, 0, '6130000000018']);
  // Ligne de total a ignorer.
  produits.addRow(['NOMBRE ITEMS', '13', '', '', '', '', '', '', '', '', '', '', '', '']);

  const generiques = classeur.addWorksheet('GENERIQUES');
  generiques.addRow(['CODE GENERIQUE', 'PRODUIT']);
  generiques.addRow(['6130000000024', 'ART001']);
  generiques.addRow(['6130000000031', 'ART002']);
  // Doublon avec le code principal d'ART001.
  generiques.addRow(['6130000000017', 'ART002']);
  // Produit inconnu.
  generiques.addRow(['6130000000048', 'ARTXXX']);
  generiques.addRow(['NOMBRE ITEMS', '4']);

  const packs = classeur.addWorksheet('PACKS');
  packs.addRow(['CODE PACK', 'CODE PRODUIT', 'NBRE UNITES', 'PRIX PACK']);
  packs.addRow(['PK001', 'ART001', 6, 4200]);
  // Pack sans prix : il serait vendu a zero.
  packs.addRow(['PK002', 'ART002', 10, 0]);
  // Produit de base inconnu.
  packs.addRow(['PK003', 'ARTZZZ', 12, 100]);

  const vracs = classeur.addWorksheet('VRACS');
  vracs.addRow(['CODE VRAC', 'CODE PRODUIT', 'NOM VRAC']);
  // Code commencant par 0 : il doit rester du texte.
  vracs.addRow(['00005', 'ART002', 'POMMES DE TERRE']);
  vracs.addRow(['00006', 'ART003', 'SAFRAN']);

  const clients = classeur.addWorksheet('CLIENTS');
  clients.addRow(['CODE', 'RAISON SOCIALE', 'TYPE CLIENT', 'SOLDE', 'CLIENT BLOQUE', 'TELEPHONE', 'CARTE FIDELITE']);
  clients.addRow(['C001', 'Cafeteria El Bahdja', 'C', 15000, 'N', '0660000001', '']);
  clients.addRow(['C002', 'Client fidele', 'F', 0, 'N', '', 'FID001']);
  clients.addRow(['C003', 'Depot interne', 'S', 0, 'N', '', '']);
  clients.addRow(['C004', 'Client bloque', 'C', -2500, 'O', '', '']);
  // Carte en doublon.
  clients.addRow(['C005', 'Autre fidele', 'F', 0, 'N', '', 'FID001']);
  // Code en doublon.
  clients.addRow(['C001', 'Doublon', 'C', 999, 'N', '', '']);
  clients.addRow(['NOMBRE ITEMS', '6', '', '', '', '', '']);

  const fournisseurs = classeur.addWorksheet('FOURNISSEURS');
  fournisseurs.addRow(['CODE FOURNISSEUR', 'RAISON SOCIALE', 'SOLDE', 'TELEPHONE']);
  fournisseurs.addRow(['F001', 'Grossiste Centre', 120000, '0550000001']);
  fournisseurs.addRow(['F002', 'Laiterie Regionale', 45000, '0550000002']);

  const tampon = await classeur.xlsx.writeBuffer();
  return Buffer.from(tampon);
}

describe('Lecture tolerante du classeur', () => {
  it('normalise les intitules de colonnes', () => {
    expect(normaliserIntitule('STOCK ACTUEL (MC)')).toBe('stock_actuel_mc');
    expect(normaliserIntitule('Référence')).toBe('reference');
    expect(normaliserIntitule('  NBRE  UNITES ')).toBe('nbre_unites');
  });

  it('lit les nombres au format francais et comptable', () => {
    expect(nombre('1 234,56')).toBeCloseTo(1234.56);
    expect(nombre('(2 500)')).toBe(-2500);
    expect(nombre('')).toBeNull();
    expect(nombre('abc')).toBeNull();
  });

  it('convertit « 00/00/0000 » en vide', () => {
    expect(dateOuNull('00/00/0000')).toBeNull();
    expect(dateOuNull('0/0/00')).toBeNull();
    expect(dateOuNull('15/03/2026')?.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('conserve comme texte un code commencant par 0', () => {
    expect(celluleEnTexte('00042')).toBe('00042');
  });
});

describe('Import a blanc du classeur de l’ancien logiciel', () => {
  let resultat: Awaited<ReturnType<ImportService['analyser']>>['resultat'];

  beforeAll(async () => {
    resultat = (await service.analyser(await classeurDeTest())).resultat;
  });

  const codes = () => resultat.anomalies.map((a) => a.code);

  it('ignore les lignes « NOMBRE ITEMS » de fin d’onglet', () => {
    expect(resultat.onglets['PRODUITS'].ignores).toBe(1);
    expect(resultat.onglets['CLIENTS'].ignores).toBe(1);
    expect(resultat.onglets['GENERIQUES'].ignores).toBe(1);
  });

  it('signale les unites aberrantes sans bloquer l’import', () => {
    const aberrantes = resultat.anomalies.filter((a) => a.code === 'UNITE_ABERRANTE');
    expect(aberrantes.map((a) => a.valeur).sort()).toEqual(['+', '.', '28272']);
    expect(aberrantes.every((a) => a.gravite === 'AVERTISSEMENT')).toBe(true);
  });

  it('convertit les grammes en kilogrammes', () => {
    expect(resultat.controles.nombreArticles).toBe(11);

    // Valeur du stock au CUMP, article par article, en centimes :
    //   ART001 144,000 milli x 620 DA ............  8 928 000
    //   ART002 620,000 milli x  65 DA ............  4 030 000
    //   ART003   2,500 milli x   2 DA ............        500
    //   ART004   4,000 milli x 100 DA ............     40 000
    //   ART005   1,000 milli x 100 DA ............     10 000
    //   ART006        0                                     0
    //   ART007  15,000 milli x 100 DA ............    150 000
    //   ART008  -6,000 milli x 100 DA ............    -60 000
    //   ART009  15,000 milli x 200 DA ............    300 000
    //   ART010   7,000 milli x 100 DA ............     70 000
    //   ART011   2,000 milli x  10 DA ............      2 000
    //                                     total .. 13 470 500
    expect(resultat.controles.valeurStockCumpCentimes).toBe(13_470_500);
  });

  it('les grammes non convertis feraient exploser la valeur du stock', () => {
    // Le safran pese 2 500 g. Sans conversion il compterait pour
    // 2 500 unites au lieu de 2,5 KG, soit 2 500 000 centimes de plus.
    const avecConversion = 13_470_500;
    const sansConversion = avecConversion - 500 + 2_500 * 200;
    expect(resultat.controles.valeurStockCumpCentimes).toBe(avecConversion);
    expect(resultat.controles.valeurStockCumpCentimes).not.toBe(sansConversion);
  });

  it('remet a zero les seuils d’alerte negatifs', () => {
    expect(codes()).toContain('SEUIL_NEGATIF');
  });

  it('compte les articles a stock nul et a stock negatif', () => {
    expect(resultat.controles.articlesStockNegatif).toBe(1);
    expect(resultat.controles.articlesStockNul).toBeGreaterThanOrEqual(1);
    expect(codes()).toContain('STOCK_NEGATIF');
  });

  it('refuse un code-barres deja attribue a un autre article', () => {
    const doublons = resultat.anomalies.filter((a) => a.code === 'CODE_BARRE_DOUBLON');
    // Un dans PRODUITS (ART010) et un dans GENERIQUES.
    expect(doublons.length).toBe(2);
    expect(doublons.every((a) => a.gravite === 'ERREUR')).toBe(true);
  });

  it('signale une cle EAN-13 fausse', () => {
    expect(codes()).toContain('EAN_CLE_INVALIDE');
  });

  it('ignore une reference en doublon et le signale', () => {
    const doublon = resultat.anomalies.find((a) => a.code === 'REFERENCE_DOUBLON');
    expect(doublon?.valeur).toBe('ART001');
  });

  it('refuse une ligne sans reference', () => {
    expect(codes()).toContain('REFERENCE_MANQUANTE');
  });

  it('signale un produit inconnu dans GENERIQUES et PACKS', () => {
    const inconnus = resultat.anomalies.filter((a) => a.code === 'PRODUIT_INCONNU');
    expect(inconnus.map((a) => a.valeur).sort()).toEqual(['ARTXXX', 'ARTZZZ']);
  });

  it('signale un pack sans prix, qui serait vendu a zero', () => {
    const sansPrix = resultat.anomalies.find((a) => a.code === 'PRIX_PACK_ABSENT');
    expect(sansPrix).toBeDefined();
    expect(sansPrix?.message).toContain('zero');
  });

  it('signale une vente a perte', () => {
    const perte = resultat.anomalies.find((a) => a.code === 'VENTE_A_PERTE');
    expect(perte?.message).toContain('sous le cout');
  });

  it('traduit les types de client F / C / S', () => {
    expect(resultat.onglets['CLIENTS'].retenus).toBe(5);
  });

  it('signale une carte fidelite attribuee deux fois', () => {
    expect(codes()).toContain('CARTE_DOUBLON');
  });

  it('refuse un code tiers en doublon', () => {
    const doublon = resultat.anomalies.find(
      (a) => a.code === 'CODE_DOUBLON' && a.valeur === 'C001',
    );
    expect(doublon).toBeDefined();
  });

  it('totalise les soldes pour le controle de bascule', () => {
    // Clients retenus : 15 000 + 0 + 0 - 2 500 + 0 = 12 500 DA
    expect(resultat.controles.totalSoldesClientsCentimes).toBe(1_250_000);
    // Fournisseurs : 120 000 + 45 000 = 165 000 DA
    expect(resultat.controles.totalSoldesFournisseursCentimes).toBe(16_500_000);
  });

  it('retient les packs et les vracs valides', () => {
    expect(resultat.controles.nombrePacks).toBe(2);
    expect(resultat.controles.nombreVracs).toBe(2);
  });

  it('distingue les erreurs bloquantes des simples avertissements', () => {
    const erreurs = resultat.anomalies.filter((a) => a.gravite === 'ERREUR');
    const avertissements = resultat.anomalies.filter((a) => a.gravite === 'AVERTISSEMENT');
    expect(erreurs.length).toBeGreaterThan(0);
    expect(avertissements.length).toBeGreaterThan(0);
    // Une unite aberrante ne doit jamais empecher la bascule.
    expect(erreurs.some((a) => a.code === 'UNITE_ABERRANTE')).toBe(false);
  });
});

describe('Reconnaissance du format reel du fichier', () => {
  const entete = (...octets: number[]) => Buffer.from([...octets, ...Array(16).fill(0x41)]);

  it('reconnait un classeur .xlsx moderne', () => {
    expect(detecterFormat(entete(0x50, 0x4b, 0x03, 0x04))).toBe('XLSX');
  });

  it('reconnait un vrai .xls binaire', () => {
    expect(detecterFormat(entete(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)))
      .toBe('XLS_BIFF');
  });

  it('demasque un tableau HTML nomme .xls', () => {
    const html = Buffer.from(
      '<html><head><meta charset="utf-8"></head><body><table><tr><td>A</td></tr></table></body></html>',
      'utf8',
    );
    expect(detecterFormat(html)).toBe('HTML');
  });

  it('reconnait le XML Excel 2003', () => {
    const xml = Buffer.from(
      '<?xml version="1.0"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">',
      'utf8',
    );
    expect(detecterFormat(xml)).toBe('SPREADSHEETML');
  });

  it('reconnait un fichier texte a separateurs', () => {
    expect(detecterFormat(Buffer.from('REFERENCE;DESIGNATION;PRIX\nART001;Huile;750\n', 'utf8')))
      .toBe('TEXTE');
  });

  it('explique quoi faire plutot que d’echouer sechement', async () => {
    const biff = entete(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    await expect(lireTampon(biff)).rejects.toThrow(/Enregistrer sous/);
    await expect(lireTampon(biff)).rejects.toThrow(/binaire \.xls/);
  });

  it('lit un export CSV comme un classeur a un onglet', async () => {
    const csv = Buffer.from(
      'REFERENCE;DESIGNATION;UNITE;PRIX DETAIL;CUMP\n' +
      'ART001;Huile de table 5 L;U;750;620\n' +
      'ART002;Semoule 10 kg;U;950;810\n' +
      'NOMBRE ITEMS;2;;;\n',
      'utf8',
    );
    const onglets = await lireTampon(csv);
    expect(onglets).toHaveLength(1);
    expect(onglets[0].lignes).toHaveLength(2);
    expect(onglets[0].lignesIgnorees).toBe(1);
    expect(onglets[0].lignes[0].valeurs.reference).toBe('ART001');
  });
});
