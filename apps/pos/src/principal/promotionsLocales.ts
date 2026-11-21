import type Database from 'better-sqlite3';
import { avantagesDeLaLigne, type AvantageLigne, type Promotion } from '@gestglobale/shared';
import type { ArticleLocal } from './catalogue';

/**
 * Promotions, lues dans la base locale de la caisse.
 *
 * Le calcul lui-meme vit dans le paquet partage : la caisse et le serveur
 * doivent donner le meme montant, sans quoi un ticket etabli hors ligne
 * ne vaudrait plus rien a la remontee.
 */

interface LignePromotion {
  id: string;
  libelle: string;
  type: string;
  debut: string;
  fin: string;
  article_id: string | null;
  famille_id: string | null;
  valeur_centimes: number | null;
  remise_pourcent: number | null;
  quantite_declenchement: number | null;
  quantite_offerte: number | null;
  heure_debut: string | null;
  heure_fin: string | null;
  cumulable: number;
}

function versPromotion(l: LignePromotion): Promotion {
  return {
    id: l.id,
    libelle: l.libelle,
    type: l.type as Promotion['type'],
    debut: l.debut,
    fin: l.fin,
    articleId: l.article_id,
    familleId: l.famille_id,
    valeurCentimes: l.valeur_centimes,
    remisePourcent: l.remise_pourcent,
    quantiteDeclenchement: l.quantite_declenchement,
    quantiteOfferte: l.quantite_offerte,
    heureDebut: l.heure_debut,
    heureFin: l.heure_fin,
    cumulable: l.cumulable === 1,
  };
}

/**
 * Promotions susceptibles de s'appliquer maintenant.
 *
 * Le filtre sur les dates est fait en SQL pour ne pas charger tout
 * l'historique promotionnel a chaque article scanne ; la plage horaire,
 * elle, est tranchee par le moteur partage.
 */
export function promotionsEnCours(base: Database.Database, maintenant = new Date()): Promotion[] {
  const horodatage = maintenant.toISOString();
  const lignes = base
    .prepare('SELECT * FROM promotion WHERE debut <= ? AND fin >= ?')
    .all(horodatage, horodatage) as LignePromotion[];
  return lignes.map(versPromotion);
}

export interface AvantageApplique extends AvantageLigne {
  articleId: string;
}

/** Avantages applicables a un article vendu a cette quantite et ce prix. */
export function avantagesPour(
  base: Database.Database,
  article: ArticleLocal,
  quantiteMilli: number,
  prixUnitaireCentimes: number,
  maintenant = new Date(),
): AvantageApplique[] {
  const avantages = avantagesDeLaLigne(
    {
      articleId: article.id,
      familleId: article.familleId,
      quantiteMilli,
      prixUnitaireCentimes,
    },
    promotionsEnCours(base, maintenant),
    maintenant,
  );
  return avantages.map((a) => ({ ...a, articleId: article.id }));
}
