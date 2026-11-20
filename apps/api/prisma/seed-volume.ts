/**
 * Jeu de donnees au volume reel, pour le test de charge.
 *
 * Reproduit les volumes de l'export VENTES_2026.xls :
 *   28 272 produits, 21 198 codes-barres secondaires, 1 735 packs,
 *   450 vracs, 7 021 clients dont ~3 460 cartes fidelite, 692 fournisseurs,
 *   stock suivi sur 2 emplacements.
 *
 * A lancer APRES le seed de demonstration, qui cree la societe, le
 * magasin, les emplacements, les caisses et les utilisateurs.
 */
import { PrismaClient, UniteMesure, CategoriePrix, TypeTiers, TypeClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

const NB_ARTICLES = 28_272;
const NB_CODES_SECONDAIRES = 21_198;
const NB_PACKS = 1_735;
const NB_VRACS = 450;
const NB_CLIENTS = 7_021;
const NB_CARTES_FIDELITE = 3_460;
const NB_FOURNISSEURS = 692;
const NB_RAYONS = 62;
const NB_FAMILLES = 73;

/** Generateur pseudo-aleatoire a graine : le jeu est reproductible. */
function generateur(graine: number): () => number {
  let etat = graine >>> 0;
  return () => {
    etat = (etat * 1664525 + 1013904223) >>> 0;
    return etat / 0x100000000;
  };
}
const alea = generateur(20261120);

function cleEan13(douze: string): number {
  let total = 0;
  for (let i = 0; i < 12; i++) total += Number(douze[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (total % 10)) % 10;
}
function ean13(base: number): string {
  const douze = String(base).padStart(12, '0').slice(-12);
  return douze + cleEan13(douze);
}

const MOTS_A = ['Huile', 'Semoule', 'Lait', 'Yaourt', 'Cafe', 'The', 'Sucre', 'Farine', 'Riz',
  'Pates', 'Conserve', 'Biscuit', 'Chocolat', 'Jus', 'Eau', 'Soda', 'Savon', 'Shampoing',
  'Lessive', 'Papier', 'Couche', 'Fromage', 'Beurre', 'Margarine', 'Tomate', 'Harissa',
  'Olive', 'Vinaigre', 'Sel', 'Poivre', 'Epice', 'Legume', 'Fruit', 'Viande', 'Poulet'];
const MOTS_B = ['extra', 'fine', 'premium', 'classique', 'familial', 'economique', 'bio',
  'traditionnel', 'du terroir', 'importe', 'local', 'sans sucre', 'allege', 'nature'];
const FORMATS = ['250 g', '500 g', '1 kg', '5 kg', '10 kg', '0,5 L', '1 L', '2 L', '5 L',
  'x6', 'x12', 'x24', 'sachet', 'boite', 'carton'];

function designation(i: number): string {
  const a = MOTS_A[Math.floor(alea() * MOTS_A.length)];
  const b = MOTS_B[Math.floor(alea() * MOTS_B.length)];
  const f = FORMATS[Math.floor(alea() * FORMATS.length)];
  return `${a} ${b} ${f} ${i % 997}`;
}

async function parLots<T>(
  elements: T[],
  taille: number,
  action: (lot: T[]) => Promise<unknown>,
  libelle: string,
): Promise<void> {
  const debut = Date.now();
  for (let i = 0; i < elements.length; i += taille) {
    await action(elements.slice(i, i + taille));
    if ((i / taille) % 10 === 0) {
      process.stdout.write(`\r  ${libelle} : ${Math.min(i + taille, elements.length)} / ${elements.length}   `);
    }
  }
  console.log(`\r  ${libelle} : ${elements.length} en ${((Date.now() - debut) / 1000).toFixed(1)} s        `);
}

async function main(): Promise<void> {
  const magasin = await prisma.magasin.findFirstOrThrow({ where: { code: 'SV' } });
  const depot = await prisma.emplacement.findFirstOrThrow({
    where: { magasinId: magasin.id, code: 'MC' },
  });
  const vente = await prisma.emplacement.findFirstOrThrow({
    where: { magasinId: magasin.id, code: 'SV' },
  });

  const dejaLa = await prisma.article.count();
  console.log(`Base de depart : ${dejaLa} article(s).`);
  console.log('Generation du volume reel...\n');

  // --- Rayons et familles ---------------------------------------------
  const rayons = Array.from({ length: NB_RAYONS }, (_, i) => ({
    id: randomUUID(),
    code: `RY${String(i + 1).padStart(3, '0')}`,
    nom: `Rayon ${i + 1}`,
    ordre: i,
  }));
  const familles = Array.from({ length: NB_FAMILLES }, (_, i) => ({
    id: randomUUID(),
    code: `FM${String(i + 1).padStart(3, '0')}`,
    nom: `Famille ${i + 1}`,
    rayonId: rayons[i % NB_RAYONS].id,
    suiviPeremption: i % 10 === 0,
    joursAlertePeremption: i % 10 === 0 ? 5 : 0,
  }));
  await prisma.rayon.createMany({ data: rayons, skipDuplicates: true });
  await prisma.famille.createMany({ data: familles, skipDuplicates: true });
  console.log(`  Rayons : ${NB_RAYONS}, familles : ${NB_FAMILLES}`);

  // --- Articles ---------------------------------------------------------
  interface Prepare {
    id: string;
    reference: string;
    designation: string;
    unite: UniteMesure;
    decimales: number;
    familleId: string;
    rayonId: string;
    cump: number;
    prixDetail: number;
    codePrincipal: string | null;
    stockMc: number;
    stockSv: number;
  }

  const articles: Prepare[] = [];
  for (let i = 1; i <= NB_ARTICLES; i++) {
    // Un article sur vingt est vendu au poids, comme les 450 vracs et
    // les fruits et legumes de l'export.
    const auPoids = i % 20 === 0;
    const cump = Math.round((50 + alea() * 90_000));
    const marge = 0.08 + alea() * 0.35;
    articles.push({
      id: randomUUID(),
      reference: `ART${String(i).padStart(5, '0')}`,
      designation: designation(i),
      unite: auPoids ? UniteMesure.KG : UniteMesure.UN,
      decimales: auPoids ? 3 : 0,
      familleId: familles[i % NB_FAMILLES].id,
      rayonId: rayons[i % NB_RAYONS].id,
      cump,
      prixDetail: Math.round(cump / (1 - marge)),
      // 24 545 articles de l'export ont un stock a 0 ; on garde cette
      // proportion, et 80 % des articles portent un code-barres.
      codePrincipal: i % 5 === 0 ? null : ean13(6_130_000_000_000 + i * 7),
      stockMc: i % 23 === 0 ? Math.round(alea() * 400) : 0,
      stockSv: i % 17 === 0 ? Math.round(alea() * 80) : 0,
    });
  }

  await parLots(articles, 2000, (lot) =>
    prisma.article.createMany({
      data: lot.map((a) => ({
        id: a.id,
        reference: a.reference,
        designation: a.designation,
        unite: a.unite,
        decimales: a.decimales,
        familleId: a.familleId,
        rayonId: a.rayonId,
        tauxTva: 0,
        estVrac: a.unite === UniteMesure.KG,
        cumpCentimes: BigInt(a.cump),
        dernierPrixAchatCentimes: BigInt(a.cump),
        archive: a.stockMc === 0 && a.stockSv === 0 && a.prixDetail === 0,
        importeDepuis: 'charge',
      })),
      skipDuplicates: true,
    }), 'Articles');

  await parLots(articles, 2000, (lot) =>
    prisma.prixArticle.createMany({
      data: lot.flatMap((a) => [
        { articleId: a.id, categorie: CategoriePrix.DETAIL, prixCentimes: BigInt(a.prixDetail) },
        { articleId: a.id, categorie: CategoriePrix.GROS,
          prixCentimes: BigInt(Math.round(a.prixDetail * 0.92)) },
      ]),
      skipDuplicates: true,
    }), 'Prix');

  const avecCode = articles.filter((a) => a.codePrincipal);
  await parLots(avecCode, 2000, (lot) =>
    prisma.codeBarre.createMany({
      data: lot.map((a) => ({
        articleId: a.id, code: a.codePrincipal as string, type: 'EAN13' as const, principal: true,
      })),
      skipDuplicates: true,
    }), 'Codes-barres principaux');

  // --- Codes-barres secondaires (les 21 198 « generiques ») ------------
  const secondaires = Array.from({ length: NB_CODES_SECONDAIRES }, (_, i) => ({
    articleId: articles[i % NB_ARTICLES].id,
    code: ean13(7_610_000_000_000 + i * 13),
    type: 'GENERIQUE' as const,
    principal: false,
  }));
  await parLots(secondaires, 2000, (lot) =>
    prisma.codeBarre.createMany({ data: lot, skipDuplicates: true }),
    'Codes-barres secondaires');

  // --- Stocks sur les deux emplacements ---------------------------------
  await parLots(articles, 2000, (lot) =>
    prisma.stock.createMany({
      data: lot.flatMap((a) => [
        { articleId: a.id, emplacementId: depot.id, quantiteMilli: a.stockMc * 1000,
          seuilAlerteMilli: 20_000 },
        { articleId: a.id, emplacementId: vente.id, quantiteMilli: a.stockSv * 1000,
          seuilAlerteMilli: 10_000, capaciteMilli: 60_000 },
      ]),
      skipDuplicates: true,
    }), 'Stocks');

  // --- Packs -------------------------------------------------------------
  const packs = Array.from({ length: NB_PACKS }, (_, i) => {
    const base = articles[(i * 13) % NB_ARTICLES];
    const unites = [4, 6, 12, 24][i % 4];
    return {
      id: randomUUID(),
      reference: `PACK${String(i + 1).padStart(5, '0')}`,
      designation: `${base.designation} — pack de ${unites}`,
      packDeId: base.id,
      packNbUnites: unites,
      cump: base.cump * unites,
      prix: Math.round(base.prixDetail * unites * 0.95),
      code: ean13(8_810_000_000_000 + i * 17),
    };
  });
  await parLots(packs, 1000, (lot) =>
    prisma.article.createMany({
      data: lot.map((p) => ({
        id: p.id, reference: p.reference, designation: p.designation, type: 'PACK' as const,
        unite: UniteMesure.UN, decimales: 0, packDeId: p.packDeId, packNbUnites: p.packNbUnites,
        cumpCentimes: BigInt(p.cump), importeDepuis: 'charge',
      })),
      skipDuplicates: true,
    }), 'Packs');
  await parLots(packs, 1000, (lot) =>
    prisma.prixArticle.createMany({
      data: lot.map((p) => ({
        articleId: p.id, categorie: CategoriePrix.PACK, prixCentimes: BigInt(p.prix),
      })),
      skipDuplicates: true,
    }), 'Prix des packs');
  await parLots(packs, 1000, (lot) =>
    prisma.codeBarre.createMany({
      data: lot.map((p) => ({
        articleId: p.id, code: p.code, type: 'INTERNE' as const, principal: true,
      })),
      skipDuplicates: true,
    }), 'Codes des packs');

  // --- Vracs : codes courts de balance ----------------------------------
  const auPoids = articles.filter((a) => a.unite === UniteMesure.KG).slice(0, NB_VRACS);
  await prisma.codeVrac.createMany({
    data: auPoids.map((a, i) => ({
      articleId: a.id,
      code: String(i + 1).padStart(5, '0'),
      nom: a.designation.toUpperCase().slice(0, 30),
    })),
    skipDuplicates: true,
  });
  console.log(`  Codes vrac : ${auPoids.length}`);

  // --- Clients et fournisseurs ------------------------------------------
  const clients = Array.from({ length: NB_CLIENTS }, (_, i) => {
    const fidelite = i < NB_CARTES_FIDELITE;
    const pro = !fidelite && i % 11 === 0;
    return {
      code: `C${String(i + 1).padStart(5, '0')}`,
      type: TypeTiers.CLIENT,
      typeClient: fidelite ? TypeClient.CARTE_FIDELITE
        : pro ? TypeClient.PROFESSIONNEL : TypeClient.PARTICULIER,
      raisonSociale: fidelite ? `Carte fidelite ${i + 1}` : `Client ${i + 1}`,
      telephone: `06${String(10_000_000 + i).slice(0, 8)}`,
      carteFidelite: fidelite ? `FID${String(i + 1).padStart(6, '0')}` : null,
      soldeCentimes: BigInt(pro ? Math.round(alea() * 500_000) : 0),
      plafondCreditCentimes: BigInt(pro ? 5_000_000 : 0),
      importeDepuis: 'charge',
    };
  });
  await parLots(clients, 2000, (lot) =>
    prisma.tiers.createMany({ data: lot, skipDuplicates: true }), 'Clients');

  const fournisseurs = Array.from({ length: NB_FOURNISSEURS }, (_, i) => ({
    code: `F${String(i + 1).padStart(5, '0')}`,
    type: TypeTiers.FOURNISSEUR,
    raisonSociale: `Fournisseur ${i + 1}`,
    telephone: `05${String(50_000_000 + i).slice(0, 8)}`,
    soldeCentimes: BigInt(Math.round(alea() * 2_000_000)),
    importeDepuis: 'charge',
  }));
  await parLots(fournisseurs, 1000, (lot) =>
    prisma.tiers.createMany({ data: lot, skipDuplicates: true }), 'Fournisseurs');

  // --- Verification ------------------------------------------------------
  const [nbArticles, nbCodes, nbStocks, nbPrix, nbClients, nbFournisseurs, nbVracs] =
    await Promise.all([
      prisma.article.count(),
      prisma.codeBarre.count(),
      prisma.stock.count(),
      prisma.prixArticle.count(),
      prisma.tiers.count({ where: { type: TypeTiers.CLIENT } }),
      prisma.tiers.count({ where: { type: TypeTiers.FOURNISSEUR } }),
      prisma.codeVrac.count(),
    ]);

  console.log(`
Volume en base :
  Articles ................ ${nbArticles.toLocaleString('fr-FR')}
  Codes-barres ............ ${nbCodes.toLocaleString('fr-FR')}
  Lignes de prix .......... ${nbPrix.toLocaleString('fr-FR')}
  Lignes de stock ......... ${nbStocks.toLocaleString('fr-FR')}
  Codes vrac .............. ${nbVracs.toLocaleString('fr-FR')}
  Clients ................. ${nbClients.toLocaleString('fr-FR')}
  Fournisseurs ............ ${nbFournisseurs.toLocaleString('fr-FR')}
`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
