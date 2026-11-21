import type Database from 'better-sqlite3';
import { analyserCodeScanne, type CategoriePrix } from '@gestglobale/shared';

export interface ArticleLocal {
  id: string;
  reference: string;
  designation: string;
  designationAr: string | null;
  unite: string;
  decimales: number;
  tauxTva: number;
  prixDetailCentimes: number;
  prixGrosCentimes: number | null;
  prixCat3Centimes: number | null;
  prixCat4Centimes: number | null;
  prixCat5Centimes: number | null;
  cumpCentimes: number;
  packDeId: string | null;
  packNbUnites: number | null;
  estVrac: boolean;
  venteAutorisee: boolean;
  familleId: string | null;
  stockSvMilli: number;
}

interface LigneArticle {
  id: string;
  reference: string;
  designation: string;
  designation_ar: string | null;
  unite: string;
  decimales: number;
  taux_tva: number;
  prix_detail_centimes: number;
  prix_gros_centimes: number | null;
  prix_cat3_centimes: number | null;
  prix_cat4_centimes: number | null;
  prix_cat5_centimes: number | null;
  cump_centimes: number;
  pack_de_id: string | null;
  pack_nb_unites: number | null;
  est_vrac: number;
  vente_autorisee: number;
  famille_id: string | null;
  stock_sv_milli: number;
}

function versArticle(ligne: LigneArticle): ArticleLocal {
  return {
    id: ligne.id,
    reference: ligne.reference,
    designation: ligne.designation,
    designationAr: ligne.designation_ar,
    unite: ligne.unite,
    decimales: ligne.decimales,
    tauxTva: ligne.taux_tva,
    prixDetailCentimes: ligne.prix_detail_centimes,
    prixGrosCentimes: ligne.prix_gros_centimes,
    prixCat3Centimes: ligne.prix_cat3_centimes,
    prixCat4Centimes: ligne.prix_cat4_centimes,
    prixCat5Centimes: ligne.prix_cat5_centimes,
    cumpCentimes: ligne.cump_centimes,
    packDeId: ligne.pack_de_id,
    packNbUnites: ligne.pack_nb_unites,
    estVrac: ligne.est_vrac === 1,
    venteAutorisee: ligne.vente_autorisee === 1,
    familleId: ligne.famille_id,
    stockSvMilli: ligne.stock_sv_milli,
  };
}

export interface ResultatRecherche {
  article: ArticleLocal;
  /** Quantite imposee par l'etiquette balance, en milli-unites. */
  quantiteMilli: number;
  prixUnitaireCentimes: number;
  /** Vrai si l'etiquette portait un prix, qui s'impose alors. */
  prixImpose: boolean;
  codeScanne: string;
}

/**
 * Recherche d'un article par code scanne.
 *
 * Exigence M4 : un article scanne doit apparaitre en moins de 0,3 seconde.
 * La requete passe par la cle primaire de `code_barre` ou l'index sur
 * `reference` : le temps ne depend pas de la taille du catalogue.
 */
export function chercherParCode(
  base: Database.Database,
  code: string,
  categorie: CategoriePrix = 'DETAIL',
): ResultatRecherche | null {
  const lu = analyserCodeScanne(code);

  let ligne = base
    .prepare(
      `SELECT a.* FROM article a
         JOIN code_barre cb ON cb.article_id = a.id
        WHERE cb.code = ?`,
    )
    .get(lu.codeRecherche) as LigneArticle | undefined;

  if (!ligne) {
    ligne = base.prepare('SELECT * FROM article WHERE reference = ?').get(lu.codeRecherche) as
      | LigneArticle
      | undefined;
  }
  if (!ligne) return null;

  const article = versArticle(ligne);
  return {
    article,
    quantiteMilli: lu.poidsMilli ?? 1000,
    prixUnitaireCentimes: lu.prixCentimes ?? prixSelonCategorie(article, categorie),
    prixImpose: lu.prixCentimes !== undefined,
    codeScanne: code,
  };
}

/** Prix applicable selon la categorie du client (M1, M6). */
export function prixSelonCategorie(article: ArticleLocal, categorie: CategoriePrix): number {
  switch (categorie) {
    case 'GROS':
      return article.prixGrosCentimes ?? article.prixDetailCentimes;
    case 'CAT3':
      return article.prixCat3Centimes ?? article.prixDetailCentimes;
    case 'CAT4':
      return article.prixCat4Centimes ?? article.prixDetailCentimes;
    case 'CAT5':
      return article.prixCat5Centimes ?? article.prixDetailCentimes;
    default:
      return article.prixDetailCentimes;
  }
}

/** Recherche par nom ou reference, pour les articles sans code-barres. */
export function chercherParTexte(
  base: Database.Database,
  texte: string,
  limite = 30,
): ArticleLocal[] {
  const motif = `%${texte.trim()}%`;
  const lignes = base
    .prepare(
      `SELECT * FROM article
        WHERE vente_autorisee = 1 AND archive = 0
          AND (designation LIKE ? OR reference LIKE ? OR designation_ar LIKE ?)
        ORDER BY designation
        LIMIT ?`,
    )
    .all(motif, motif, motif, limite) as LigneArticle[];
  return lignes.map(versArticle);
}

export function articleParId(base: Database.Database, id: string): ArticleLocal | null {
  const ligne = base.prepare('SELECT * FROM article WHERE id = ?').get(id) as
    | LigneArticle
    | undefined;
  return ligne ? versArticle(ligne) : null;
}
