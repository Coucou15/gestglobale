import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { c } from '../commun/bigint';

/**
 * Rapports de periode (M9).
 *
 * Les agregations passent par des requetes SQL dediees plutot que par un
 * chargement des lignes en memoire : un mois de ventes represente environ
 * 13 000 tickets et 40 000 lignes, qu'il serait absurde de rapatrier.
 */
@Injectable()
export class RapportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Synthese d'une periode : ce que le gerant lit en fin de mois. */
  async periode(params: { magasinIds: string[]; debut: Date; fin: Date }) {
    const { magasinIds, debut, fin } = params;

    const [
      totaux, parJour, parMode, parCaissier, parHeure, parCaisse, parFamille, parMagasin,
    ] = await Promise.all([
      this.prisma.$queryRaw<Array<{
        tickets: bigint; ca_ttc: bigint | null; ca_ht: bigint | null;
        marge: bigint | null; annulations: bigint;
      }>>`
        SELECT COUNT(*) FILTER (WHERE "statut" = 'VALIDE')            AS tickets,
               SUM("totalTtcCentimes") FILTER (WHERE "statut" = 'VALIDE') AS ca_ttc,
               SUM("totalHtCentimes")  FILTER (WHERE "statut" = 'VALIDE') AS ca_ht,
               SUM("margeCentimes")    FILTER (WHERE "statut" = 'VALIDE') AS marge,
               COUNT(*) FILTER (WHERE "statut" = 'ANNULE')            AS annulations
          FROM "DocumentVente"
         WHERE "magasinId" = ANY(${magasinIds}::text[])
           AND "dateVente" >= ${debut} AND "dateVente" < ${fin}`,

      this.prisma.$queryRaw<Array<{ jour: Date; tickets: bigint; ca: bigint | null }>>`
        SELECT date_trunc('day', "dateVente") AS jour,
               COUNT(*)                        AS tickets,
               SUM("totalTtcCentimes")         AS ca
          FROM "DocumentVente"
         WHERE "magasinId" = ANY(${magasinIds}::text[])
           AND "statut" = 'VALIDE'
           AND "dateVente" >= ${debut} AND "dateVente" < ${fin}
         GROUP BY 1 ORDER BY 1`,

      this.prisma.$queryRaw<Array<{ mode: string; montant: bigint | null }>>`
        SELECT r."mode" AS mode, SUM(r."montantCentimes") AS montant
          FROM "Reglement" r
          JOIN "DocumentVente" d ON d."id" = r."documentId"
         WHERE d."magasinId" = ANY(${magasinIds}::text[])
           AND d."statut" = 'VALIDE'
           AND d."dateVente" >= ${debut} AND d."dateVente" < ${fin}
         GROUP BY 1 ORDER BY 2 DESC`,

      this.prisma.$queryRaw<Array<{
        code: string; nom: string; tickets: bigint; ca: bigint | null;
      }>>`
        SELECT u."code", u."nom",
               COUNT(*)                AS tickets,
               SUM(d."totalTtcCentimes") AS ca
          FROM "DocumentVente" d
          JOIN "Utilisateur" u ON u."id" = d."utilisateurId"
         WHERE d."magasinId" = ANY(${magasinIds}::text[])
           AND d."statut" = 'VALIDE'
           AND d."dateVente" >= ${debut} AND d."dateVente" < ${fin}
         GROUP BY 1, 2 ORDER BY 4 DESC`,

      // Par heure : c'est ce qui dit ou placer les caissiers et quand
      // ouvrir la deuxieme caisse.
      this.prisma.$queryRaw<Array<{
        heure: number; tickets: bigint; ca: bigint | null; marge: bigint | null;
      }>>`
        SELECT EXTRACT(HOUR FROM "dateVente")::int AS heure,
               COUNT(*)                            AS tickets,
               SUM("totalTtcCentimes")             AS ca,
               SUM("margeCentimes")                AS marge
          FROM "DocumentVente"
         WHERE "magasinId" = ANY(${magasinIds}::text[])
           AND "statut" = 'VALIDE'
           AND "dateVente" >= ${debut} AND "dateVente" < ${fin}
         GROUP BY 1 ORDER BY 1`,

      this.prisma.$queryRaw<Array<{
        numero: number | null; tickets: bigint; ca: bigint | null; marge: bigint | null;
      }>>`
        SELECT ca."numero",
               COUNT(*)                   AS tickets,
               SUM(d."totalTtcCentimes")  AS ca,
               SUM(d."margeCentimes")     AS marge
          FROM "DocumentVente" d
          LEFT JOIN "Caisse" ca ON ca."id" = d."caisseId"
         WHERE d."magasinId" = ANY(${magasinIds}::text[])
           AND d."statut" = 'VALIDE'
           AND d."dateVente" >= ${debut} AND d."dateVente" < ${fin}
         GROUP BY 1 ORDER BY 1 NULLS LAST`,

      // Par famille, avec son rayon : le gerant raisonne par rayon pour
      // ses commandes et par famille pour ses marges.
      this.prisma.$queryRaw<Array<{
        rayon: string | null; famille: string | null;
        quantite: bigint | null; ca: bigint | null; marge: bigint | null;
      }>>`
        SELECT r."nom" AS rayon, f."nom" AS famille,
               SUM(l."quantiteMilli")::bigint AS quantite,
               SUM(l."totalTtcCentimes")      AS ca,
               SUM(l."margeCentimes")         AS marge
          FROM "LigneVente" l
          JOIN "DocumentVente" d ON d."id" = l."documentId"
          JOIN "Article" a       ON a."id" = l."articleId"
          LEFT JOIN "Famille" f  ON f."id" = a."familleId"
          LEFT JOIN "Rayon" r    ON r."id" = COALESCE(f."rayonId", a."rayonId")
         WHERE d."magasinId" = ANY(${magasinIds}::text[])
           AND d."statut" = 'VALIDE' AND l."annulee" = false
           AND d."dateVente" >= ${debut} AND d."dateVente" < ${fin}
         GROUP BY 1, 2 ORDER BY 4 DESC`,

      // Par magasin : exige par la section 9, et socle de la
      // consolidation du groupe (M11).
      this.prisma.$queryRaw<Array<{
        code: string; nom: string; tickets: bigint;
        ca: bigint | null; marge: bigint | null;
      }>>`
        SELECT m."code", m."nom",
               COUNT(*)                  AS tickets,
               SUM(d."totalTtcCentimes") AS ca,
               SUM(d."margeCentimes")    AS marge
          FROM "DocumentVente" d
          JOIN "Magasin" m ON m."id" = d."magasinId"
         WHERE d."magasinId" = ANY(${magasinIds}::text[])
           AND d."statut" = 'VALIDE'
           AND d."dateVente" >= ${debut} AND d."dateVente" < ${fin}
         GROUP BY 1, 2 ORDER BY 4 DESC`,
    ]);

    const t = totaux[0];
    const tickets = Number(t?.tickets ?? 0);
    const caTtc = c(t?.ca_ttc);

    return {
      periode: { debut, fin },
      nombreTickets: tickets,
      nombreAnnulations: Number(t?.annulations ?? 0),
      chiffreAffairesTtcCentimes: caTtc,
      chiffreAffairesHtCentimes: c(t?.ca_ht),
      margeCentimes: c(t?.marge),
      panierMoyenCentimes: tickets > 0 ? Math.round(caTtc / tickets) : 0,
      parJour: parJour.map((j) => ({
        jour: j.jour,
        nombreTickets: Number(j.tickets),
        chiffreAffairesCentimes: c(j.ca),
      })),
      parModePaiement: parMode.map((m) => ({ mode: m.mode, montantCentimes: c(m.montant) })),
      parCaissier: parCaissier.map((p) => ({
        code: p.code, nom: p.nom,
        nombreTickets: Number(p.tickets),
        chiffreAffairesCentimes: c(p.ca),
      })),
      parHeure: parHeure.map((h) => ({
        heure: h.heure,
        nombreTickets: Number(h.tickets),
        chiffreAffairesCentimes: c(h.ca),
        margeCentimes: c(h.marge),
      })),
      parCaisse: parCaisse.map((p) => ({
        numeroCaisse: p.numero,
        nombreTickets: Number(p.tickets),
        chiffreAffairesCentimes: c(p.ca),
        margeCentimes: c(p.marge),
      })),
      parMagasin: parMagasin.map((p) => ({
        code: p.code,
        nom: p.nom,
        nombreTickets: Number(p.tickets),
        chiffreAffairesCentimes: c(p.ca),
        margeCentimes: c(p.marge),
      })),
      parFamille: parFamille.map((p) => ({
        rayon: p.rayon,
        famille: p.famille,
        quantiteMilli: Number(p.quantite ?? 0),
        chiffreAffairesCentimes: c(p.ca),
        margeCentimes: c(p.marge),
      })),
    };
  }

  /**
   * Top et flop produits sur une periode (M9).
   * `sens` vaut 'TOP' pour les meilleures ventes, 'FLOP' pour les pires.
   */
  async produits(params: {
    magasinIds: string[]; debut: Date; fin: Date; sens: 'TOP' | 'FLOP'; limite?: number;
  }) {
    const limite = Math.min(params.limite ?? 20, 200);
    const lignes = params.sens === 'TOP'
      ? await this.prisma.$queryRaw<Array<{
          reference: string; designation: string; quantite: bigint;
          ca: bigint | null; marge: bigint | null;
        }>>`
          SELECT a."reference", a."designation",
                 SUM(l."quantiteMilli")::bigint AS quantite,
                 SUM(l."totalTtcCentimes")      AS ca,
                 SUM(l."margeCentimes")         AS marge
            FROM "LigneVente" l
            JOIN "DocumentVente" d ON d."id" = l."documentId"
            JOIN "Article" a       ON a."id" = l."articleId"
           WHERE d."magasinId" = ANY(${params.magasinIds}::text[])
             AND d."statut" = 'VALIDE' AND l."annulee" = false
             AND d."dateVente" >= ${params.debut} AND d."dateVente" < ${params.fin}
           GROUP BY 1, 2 ORDER BY 4 DESC LIMIT ${limite}`
      : await this.prisma.$queryRaw<Array<{
          reference: string; designation: string; quantite: bigint;
          ca: bigint | null; marge: bigint | null;
        }>>`
          SELECT a."reference", a."designation",
                 SUM(l."quantiteMilli")::bigint AS quantite,
                 SUM(l."totalTtcCentimes")      AS ca,
                 SUM(l."margeCentimes")         AS marge
            FROM "LigneVente" l
            JOIN "DocumentVente" d ON d."id" = l."documentId"
            JOIN "Article" a       ON a."id" = l."articleId"
           WHERE d."magasinId" = ANY(${params.magasinIds}::text[])
             AND d."statut" = 'VALIDE' AND l."annulee" = false
             AND d."dateVente" >= ${params.debut} AND d."dateVente" < ${params.fin}
           GROUP BY 1, 2 ORDER BY 5 ASC LIMIT ${limite}`;

    return lignes.map((l) => ({
      reference: l.reference,
      designation: l.designation,
      quantiteMilli: Number(l.quantite),
      chiffreAffairesCentimes: c(l.ca),
      margeCentimes: c(l.marge),
      venteAPerte: c(l.marge) < 0,
    }));
  }

  /**
   * Produits dormants : jamais vendus depuis N jours, stock encore present.
   * C'est l'argent immobilise en rayon (M9).
   */
  async dormants(params: { magasinIds: string[]; jours: number; limite?: number }) {
    const depuis = new Date();
    depuis.setDate(depuis.getDate() - params.jours);
    const limite = Math.min(params.limite ?? 100, 500);

    const lignes = await this.prisma.$queryRaw<Array<{
      reference: string; designation: string; stock: number; valeur: bigint | null;
    }>>`
      SELECT a."reference", a."designation",
             SUM(s."quantiteMilli")::int AS stock,
             SUM(s."quantiteMilli"::bigint * a."cumpCentimes" / 1000) AS valeur
        FROM "Article" a
        JOIN "Stock" s        ON s."articleId" = a."id"
        JOIN "Emplacement" e  ON e."id" = s."emplacementId"
       WHERE e."magasinId" = ANY(${params.magasinIds}::text[])
         AND a."archive" = false
         AND s."quantiteMilli" > 0
         AND NOT EXISTS (
           SELECT 1 FROM "LigneVente" l
             JOIN "DocumentVente" d ON d."id" = l."documentId"
            WHERE l."articleId" = a."id" AND d."dateVente" >= ${depuis}
         )
       GROUP BY 1, 2
       ORDER BY 4 DESC
       LIMIT ${limite}`;

    return lignes.map((l) => ({
      reference: l.reference,
      designation: l.designation,
      stockMilli: l.stock,
      valeurImmobiliseeCentimes: c(l.valeur),
    }));
  }
  /**
   * Ruptures et sous-seuils (M9).
   *
   * Deux situations differentes qu'il serait trompeur de melanger : un
   * article a zero ne se vend plus du tout, un article sous son seuil se
   * vend encore mais doit etre commande. La colonne `rupture` les
   * distingue, et le tri met les ruptures en premier.
   */
  async ruptures(params: { magasinIds: string[]; limite?: number }) {
    const limite = Math.min(params.limite ?? 200, 1000);

    // Les ventes des 30 derniers jours sont agregees une seule fois, puis
    // jointes. La version precedente posait une sous-requete correlee par
    // ligne de stock : sur le volume reel, 53 918 lignes candidates la
    // declenchaient chacune et le rapport mettait 58 secondes. Le meme
    // calcul en une passe prend quelques millisecondes.
    const lignes = await this.prisma.$queryRaw<Array<{
      reference: string; designation: string; unite: string;
      emplacement: string; stock: number; seuil: number;
      ventes30j: bigint | null; derniere_sortie: Date | null;
    }>>`
      WITH ventes_recentes AS (
        SELECT l."articleId", SUM(l."quantiteMilli") AS quantite
          FROM "LigneVente" l
          JOIN "DocumentVente" d ON d."id" = l."documentId"
         WHERE d."dateVente" >= NOW() - INTERVAL '30 days'
           AND d."statut" = 'VALIDE' AND l."annulee" = false
         GROUP BY 1
      )
      SELECT a."reference", a."designation", a."unite"::text AS unite,
             e."code" AS emplacement,
             s."quantiteMilli"     AS stock,
             s."seuilAlerteMilli"  AS seuil,
             v."quantite"          AS ventes30j,
             s."derniereSortie"    AS derniere_sortie
        FROM "Stock" s
        JOIN "Article" a      ON a."id" = s."articleId"
        JOIN "Emplacement" e  ON e."id" = s."emplacementId"
        LEFT JOIN ventes_recentes v ON v."articleId" = a."id"
       WHERE e."magasinId" = ANY(${params.magasinIds}::text[])
         AND e."type" <> 'TRANSIT'
         AND a."archive" = false
         AND a."venteAutorisee" = true
         AND (s."quantiteMilli" <= 0
              OR (s."seuilAlerteMilli" > 0 AND s."quantiteMilli" <= s."seuilAlerteMilli"))
       ORDER BY (s."quantiteMilli" <= 0) DESC, v."quantite" DESC NULLS LAST
       LIMIT ${limite}`;

    return lignes.map((l) => ({
      reference: l.reference,
      designation: l.designation,
      unite: l.unite,
      emplacement: l.emplacement,
      stockMilli: l.stock,
      seuilAlerteMilli: l.seuil,
      rupture: l.stock <= 0,
      quantiteVendue30jMilli: Number(l.ventes30j ?? 0),
      derniereSortie: l.derniere_sortie,
    }));
  }

  /**
   * Ventes a perte : prix de vente sous le CUMP (M9).
   *
   * La marge est figee ligne par ligne au moment de la vente, donc ce
   * rapport dit ce qui s'est reellement passe, pas ce que donnerait le
   * CUMP d'aujourd'hui. Une perte n'est pas forcement une erreur : une
   * promotion d'appel ou un produit proche de la peremption se vendent
   * sciemment a perte. Le rapport la rend visible, il ne la juge pas.
   */
  async ventesAPerte(params: {
    magasinIds: string[]; debut: Date; fin: Date; limite?: number;
  }) {
    const limite = Math.min(params.limite ?? 100, 500);

    const [lignes, cumul] = await Promise.all([
      this.prisma.$queryRaw<Array<{
        reference: string; designation: string;
        quantite: bigint | null; ca: bigint | null; perte: bigint | null;
        prix_moyen: number | null; cump_moyen: number | null;
        promotions: bigint;
      }>>`
        SELECT a."reference", a."designation",
               SUM(l."quantiteMilli")::bigint AS quantite,
               SUM(l."totalTtcCentimes")      AS ca,
               -SUM(l."margeCentimes")        AS perte,
               AVG(l."prixUnitaireCentimes")::float AS prix_moyen,
               AVG(l."cumpCentimes")::float         AS cump_moyen,
               COUNT(*) FILTER (WHERE l."promotionId" IS NOT NULL) AS promotions
          FROM "LigneVente" l
          JOIN "DocumentVente" d ON d."id" = l."documentId"
          JOIN "Article" a       ON a."id" = l."articleId"
         WHERE d."magasinId" = ANY(${params.magasinIds}::text[])
           AND d."statut" = 'VALIDE' AND l."annulee" = false
           AND l."margeCentimes" < 0
           AND d."dateVente" >= ${params.debut} AND d."dateVente" < ${params.fin}
         GROUP BY 1, 2 ORDER BY 5 DESC LIMIT ${limite}`,

      this.prisma.$queryRaw<Array<{ lignes: bigint; perte: bigint | null }>>`
        SELECT COUNT(*) AS lignes, -SUM(l."margeCentimes") AS perte
          FROM "LigneVente" l
          JOIN "DocumentVente" d ON d."id" = l."documentId"
         WHERE d."magasinId" = ANY(${params.magasinIds}::text[])
           AND d."statut" = 'VALIDE' AND l."annulee" = false
           AND l."margeCentimes" < 0
           AND d."dateVente" >= ${params.debut} AND d."dateVente" < ${params.fin}`,
    ]);

    return {
      periode: { debut: params.debut, fin: params.fin },
      nombreLignes: Number(cumul[0]?.lignes ?? 0),
      perteTotaleCentimes: c(cumul[0]?.perte),
      articles: lignes.map((l) => ({
        reference: l.reference,
        designation: l.designation,
        quantiteMilli: Number(l.quantite ?? 0),
        chiffreAffairesCentimes: c(l.ca),
        perteCentimes: c(l.perte),
        prixMoyenCentimes: Math.round(l.prix_moyen ?? 0),
        cumpMoyenCentimes: Math.round(l.cump_moyen ?? 0),
        /** Nombre de lignes ou une promotion explique la perte. */
        lignesEnPromotion: Number(l.promotions),
      })),
    };
  }

  /**
   * Ecarts de caisse par caissier (M9).
   *
   * Le defaut qui a motive ce projet : l'ancien logiciel affichait une
   * recette physique a zero et des ecarts de dizaines de milliers de
   * dinars sans que personne ne sache d'ou ils venaient. Ici chaque
   * cloture porte son comptage, son ecart et sa justification, et ce
   * rapport les rassemble par caissier.
   *
   * Un ecart n'accuse personne : un total de ticket tombe sur n'importe
   * quel centime, alors que la plus petite coupure vaut 5 DA. Une partie
   * de l'ecart est donc structurelle. Ce qui se lit ici, c'est la
   * derive : un caissier toujours court dans le meme sens.
   */
  async ecartsDeCaisse(params: { magasinIds: string[]; jours?: number }) {
    const jours = Math.min(Math.max(params.jours ?? 30, 1), 365);
    const depuis = new Date();
    depuis.setDate(depuis.getDate() - jours);

    const [parCaissier, clotures] = await Promise.all([
      this.prisma.$queryRaw<Array<{
        code: string; nom: string; clotures: bigint;
        ecart_total: bigint | null; ecart_absolu: bigint | null;
        manquants: bigint; excedents: bigint; non_justifies: bigint;
      }>>`
        SELECT u."code", u."nom",
               COUNT(*)                                   AS clotures,
               SUM(z."ecartCentimes")                      AS ecart_total,
               SUM(ABS(z."ecartCentimes"))                 AS ecart_absolu,
               COUNT(*) FILTER (WHERE z."ecartCentimes" < 0) AS manquants,
               COUNT(*) FILTER (WHERE z."ecartCentimes" > 0) AS excedents,
               COUNT(*) FILTER (
                 WHERE z."ecartCentimes" <> 0
                   AND (z."justification" IS NULL OR z."justification" = '')
               )                                           AS non_justifies
          FROM "ClotureZ" z
          JOIN "SessionCaisse" ses ON ses."id" = z."sessionId"
          JOIN "Caisse" ca         ON ca."id" = ses."caisseId"
          JOIN "Utilisateur" u     ON u."id" = COALESCE(
                 ses."utilisateurClotureId", ses."utilisateurOuvertureId")
         WHERE ca."magasinId" = ANY(${params.magasinIds}::text[])
           AND z."clotureeLe" >= ${depuis}
         GROUP BY 1, 2 ORDER BY 5 DESC`,

      this.prisma.$queryRaw<Array<{
        numero: string; cloturee_le: Date; caisse: number;
        code: string; nom: string;
        theorique: bigint; compte: bigint; ecart: bigint;
        justification: string | null; hors_ligne: boolean;
      }>>`
        SELECT z."numero", z."clotureeLe" AS cloturee_le, ca."numero" AS caisse,
               u."code", u."nom",
               z."theoriqueEspecesCentimes" AS theorique,
               z."compteEspecesCentimes"    AS compte,
               z."ecartCentimes"            AS ecart,
               z."justification", z."horsLigne" AS hors_ligne
          FROM "ClotureZ" z
          JOIN "SessionCaisse" ses ON ses."id" = z."sessionId"
          JOIN "Caisse" ca         ON ca."id" = ses."caisseId"
          JOIN "Utilisateur" u     ON u."id" = COALESCE(
                 ses."utilisateurClotureId", ses."utilisateurOuvertureId")
         WHERE ca."magasinId" = ANY(${params.magasinIds}::text[])
           AND z."clotureeLe" >= ${depuis}
         ORDER BY z."clotureeLe" DESC
         LIMIT 500`,
    ]);

    return {
      depuis,
      jours,
      parCaissier: parCaissier.map((p) => {
        const nombre = Number(p.clotures);
        return {
          code: p.code,
          nom: p.nom,
          nombreClotures: nombre,
          /** Somme signee : revele une derive dans un sens. */
          ecartCumuleCentimes: c(p.ecart_total),
          /** Somme des valeurs absolues : revele l'imprecision. */
          ecartAbsoluCentimes: c(p.ecart_absolu),
          ecartMoyenCentimes: nombre > 0 ? Math.round(c(p.ecart_absolu) / nombre) : 0,
          nombreManquants: Number(p.manquants),
          nombreExcedents: Number(p.excedents),
          nombreNonJustifies: Number(p.non_justifies),
        };
      }),
      clotures: clotures.map((z) => ({
        numero: z.numero,
        clotureeLe: z.cloturee_le,
        numeroCaisse: z.caisse,
        caissierCode: z.code,
        caissierNom: z.nom,
        theoriqueEspecesCentimes: c(z.theorique),
        compteEspecesCentimes: c(z.compte),
        ecartCentimes: c(z.ecart),
        justification: z.justification,
        horsLigne: z.hors_ligne,
      })),
    };
  }

  /**
   * Journal des annulations et des remises (M9).
   *
   * Une annulation de ticket et une remise de ligne sont les deux gestes
   * par lesquels de l'argent peut sortir sans marchandise. Le cahier des
   * charges les veut tracables : qui, quand, sur quoi, et qui a autorise.
   */
  async annulationsEtRemises(params: {
    magasinIds: string[]; debut: Date; fin: Date; limite?: number;
  }) {
    const limite = Math.min(params.limite ?? 200, 1000);

    const [annulations, remises, cumulRemises] = await Promise.all([
      this.prisma.$queryRaw<Array<{
        numero: string; date_vente: Date; caisse: number | null;
        code: string; nom: string; total: bigint; lignes: bigint;
      }>>`
        SELECT d."numero", d."dateVente" AS date_vente, ca."numero" AS caisse,
               u."code", u."nom",
               d."totalTtcCentimes" AS total,
               (SELECT COUNT(*) FROM "LigneVente" l WHERE l."documentId" = d."id") AS lignes
          FROM "DocumentVente" d
          JOIN "Utilisateur" u ON u."id" = d."utilisateurId"
          LEFT JOIN "Caisse" ca ON ca."id" = d."caisseId"
         WHERE d."magasinId" = ANY(${params.magasinIds}::text[])
           AND d."statut" = 'ANNULE'
           AND d."dateVente" >= ${params.debut} AND d."dateVente" < ${params.fin}
         ORDER BY d."dateVente" DESC LIMIT ${limite}`,

      this.prisma.$queryRaw<Array<{
        numero: string; date_vente: Date; caisse: number | null;
        code: string; nom: string;
        reference: string; designation: string;
        remise_pourcent: number; remise: bigint;
        prix: bigint; autorise_code: string | null; autorise_nom: string | null;
      }>>`
        SELECT d."numero", d."dateVente" AS date_vente, ca."numero" AS caisse,
               u."code", u."nom",
               a."reference", a."designation",
               l."remisePourcent" AS remise_pourcent,
               l."remiseCentimes" AS remise,
               l."prixUnitaireCentimes" AS prix,
               sup."code" AS autorise_code, sup."nom" AS autorise_nom
          FROM "LigneVente" l
          JOIN "DocumentVente" d ON d."id" = l."documentId"
          JOIN "Article" a       ON a."id" = l."articleId"
          JOIN "Utilisateur" u   ON u."id" = d."utilisateurId"
          LEFT JOIN "Caisse" ca  ON ca."id" = d."caisseId"
          LEFT JOIN "Utilisateur" sup ON sup."id" = l."autoriseeParId"
         WHERE d."magasinId" = ANY(${params.magasinIds}::text[])
           AND d."statut" = 'VALIDE' AND l."annulee" = false
           AND l."remiseCentimes" > 0
           AND d."dateVente" >= ${params.debut} AND d."dateVente" < ${params.fin}
         ORDER BY l."remiseCentimes" DESC LIMIT ${limite}`,

      this.prisma.$queryRaw<Array<{
        code: string; nom: string; nombre: bigint; remise: bigint | null;
        forcees: bigint;
      }>>`
        SELECT u."code", u."nom",
               COUNT(*)                   AS nombre,
               SUM(l."remiseCentimes")    AS remise,
               COUNT(*) FILTER (WHERE l."autoriseeParId" IS NOT NULL) AS forcees
          FROM "LigneVente" l
          JOIN "DocumentVente" d ON d."id" = l."documentId"
          JOIN "Utilisateur" u   ON u."id" = d."utilisateurId"
         WHERE d."magasinId" = ANY(${params.magasinIds}::text[])
           AND d."statut" = 'VALIDE' AND l."annulee" = false
           AND l."remiseCentimes" > 0
           AND d."dateVente" >= ${params.debut} AND d."dateVente" < ${params.fin}
         GROUP BY 1, 2 ORDER BY 4 DESC`,
    ]);

    return {
      periode: { debut: params.debut, fin: params.fin },
      annulations: annulations.map((a) => ({
        numero: a.numero,
        dateVente: a.date_vente,
        numeroCaisse: a.caisse,
        caissierCode: a.code,
        caissierNom: a.nom,
        totalTtcCentimes: c(a.total),
        nombreLignes: Number(a.lignes),
      })),
      remises: remises.map((r) => ({
        numero: r.numero,
        dateVente: r.date_vente,
        numeroCaisse: r.caisse,
        caissierCode: r.code,
        caissierNom: r.nom,
        reference: r.reference,
        designation: r.designation,
        remisePourcent: r.remise_pourcent,
        remiseCentimes: c(r.remise),
        prixUnitaireCentimes: c(r.prix),
        autoriseeParCode: r.autorise_code,
        autoriseeParNom: r.autorise_nom,
      })),
      remisesParCaissier: cumulRemises.map((r) => ({
        code: r.code,
        nom: r.nom,
        nombreRemises: Number(r.nombre),
        totalRemiseCentimes: c(r.remise),
        /** Remises au-dela du plafond, autorisees par un responsable. */
        nombreForcees: Number(r.forcees),
      })),
    };
  }
  /**
   * Consolidation du groupe (M11).
   *
   * Ventes, stocks et tresorerie de toutes les superettes, cote a cote
   * puis additionnes. Le gerant du groupe doit pouvoir comparer ses
   * magasins sur la meme page : c'est la seule facon de voir qu'une
   * boutique decroche, ou qu'une autre immobilise trop de stock.
   *
   * La marchandise en transit apparait a part. Elle appartient encore au
   * magasin expediteur, mais elle n'est plus dans ses rayons : la
   * confondre avec du stock vendable ferait croire a une disponibilite
   * qui n'existe pas.
   */
  async consolidation(params: { magasinIds: string[]; debut: Date; fin: Date }) {
    const { magasinIds, debut, fin } = params;

    const [magasins, ventes, stocks, transit, tresorerie, ruptures] = await Promise.all([
      this.prisma.magasin.findMany({
        where: { id: { in: magasinIds } },
        select: { id: true, code: true, nom: true, actif: true },
        orderBy: { code: 'asc' },
      }),

      this.prisma.$queryRaw<Array<{
        magasin_id: string; tickets: bigint; ca: bigint | null;
        ca_ht: bigint | null; marge: bigint | null; annulations: bigint;
      }>>`
        SELECT "magasinId" AS magasin_id,
               COUNT(*) FILTER (WHERE "statut" = 'VALIDE')                AS tickets,
               SUM("totalTtcCentimes") FILTER (WHERE "statut" = 'VALIDE') AS ca,
               SUM("totalHtCentimes")  FILTER (WHERE "statut" = 'VALIDE') AS ca_ht,
               SUM("margeCentimes")    FILTER (WHERE "statut" = 'VALIDE') AS marge,
               COUNT(*) FILTER (WHERE "statut" = 'ANNULE')                AS annulations
          FROM "DocumentVente"
         WHERE "magasinId" = ANY(${magasinIds}::text[])
           AND "dateVente" >= ${debut} AND "dateVente" < ${fin}
         GROUP BY 1`,

      // Stock vendable : le transit est exclu, il est compte a part.
      this.prisma.$queryRaw<Array<{
        magasin_id: string; references: bigint; valeur: bigint | null;
      }>>`
        SELECT e."magasinId" AS magasin_id,
               COUNT(DISTINCT s."articleId")                              AS references,
               SUM(s."quantiteMilli"::bigint * a."cumpCentimes" / 1000)   AS valeur
          FROM "Stock" s
          JOIN "Emplacement" e ON e."id" = s."emplacementId"
          JOIN "Article" a     ON a."id" = s."articleId"
         WHERE e."magasinId" = ANY(${magasinIds}::text[])
           AND e."type" <> 'TRANSIT'
           AND s."quantiteMilli" > 0
         GROUP BY 1`,

      this.prisma.$queryRaw<Array<{
        magasin_id: string; references: bigint; valeur: bigint | null;
      }>>`
        SELECT e."magasinId" AS magasin_id,
               COUNT(DISTINCT s."articleId")                              AS references,
               SUM(s."quantiteMilli"::bigint * a."cumpCentimes" / 1000)   AS valeur
          FROM "Stock" s
          JOIN "Emplacement" e ON e."id" = s."emplacementId"
          JOIN "Article" a     ON a."id" = s."articleId"
         WHERE e."magasinId" = ANY(${magasinIds}::text[])
           AND e."type" = 'TRANSIT'
           AND s."quantiteMilli" <> 0
         GROUP BY 1`,

      this.prisma.$queryRaw<Array<{
        magasin_id: string | null; solde: bigint | null; comptes: bigint;
      }>>`
        SELECT "magasinId" AS magasin_id,
               SUM("soldeCentimes") AS solde,
               COUNT(*)             AS comptes
          FROM "CompteTresorerie"
         WHERE "actif" = true
           AND ("magasinId" = ANY(${magasinIds}::text[]) OR "magasinId" IS NULL)
         GROUP BY 1`,

      this.prisma.$queryRaw<Array<{ magasin_id: string; ruptures: bigint }>>`
        SELECT e."magasinId" AS magasin_id, COUNT(*) AS ruptures
          FROM "Stock" s
          JOIN "Emplacement" e ON e."id" = s."emplacementId"
          JOIN "Article" a     ON a."id" = s."articleId"
         WHERE e."magasinId" = ANY(${magasinIds}::text[])
           AND e."type" <> 'TRANSIT'
           AND a."archive" = false AND a."venteAutorisee" = true
           AND s."quantiteMilli" <= 0
         GROUP BY 1`,
    ]);

    const parMagasinId = <T extends { magasin_id: string | null }>(lignes: T[]) =>
      new Map(lignes.filter((l) => l.magasin_id !== null).map((l) => [l.magasin_id!, l]));

    const vente = parMagasinId(ventes);
    const stock = parMagasinId(stocks);
    const enTransit = parMagasinId(transit);
    const caisse = parMagasinId(tresorerie);
    const rupture = parMagasinId(ruptures);

    const lignes = magasins.map((m) => {
      const v = vente.get(m.id);
      const tickets = Number(v?.tickets ?? 0);
      const caTtc = c(v?.ca);
      return {
        magasinId: m.id,
        code: m.code,
        nom: m.nom,
        actif: m.actif,
        nombreTickets: tickets,
        nombreAnnulations: Number(v?.annulations ?? 0),
        chiffreAffairesTtcCentimes: caTtc,
        chiffreAffairesHtCentimes: c(v?.ca_ht),
        margeCentimes: c(v?.marge),
        panierMoyenCentimes: tickets > 0 ? Math.round(caTtc / tickets) : 0,
        nombreReferencesEnStock: Number(stock.get(m.id)?.references ?? 0),
        valeurStockCentimes: c(stock.get(m.id)?.valeur),
        valeurEnTransitCentimes: c(enTransit.get(m.id)?.valeur),
        tresorerieCentimes: c(caisse.get(m.id)?.solde),
        nombreRuptures: Number(rupture.get(m.id)?.ruptures ?? 0),
      };
    });

    // Les comptes du siege n'appartiennent a aucun magasin : ils comptent
    // dans le total du groupe mais ne doivent etre imputes a personne.
    const siege = tresorerie.find((t) => t.magasin_id === null);

    const somme = (champ: keyof (typeof lignes)[number]) =>
      lignes.reduce((t, l) => t + Number(l[champ] ?? 0), 0);

    const caGroupe = somme('chiffreAffairesTtcCentimes');
    const ticketsGroupe = somme('nombreTickets');

    return {
      periode: { debut, fin },
      magasins: lignes,
      siege: siege
        ? { tresorerieCentimes: c(siege.solde), nombreComptes: Number(siege.comptes) }
        : null,
      groupe: {
        nombreMagasins: lignes.length,
        nombreTickets: ticketsGroupe,
        nombreAnnulations: somme('nombreAnnulations'),
        chiffreAffairesTtcCentimes: caGroupe,
        chiffreAffairesHtCentimes: somme('chiffreAffairesHtCentimes'),
        margeCentimes: somme('margeCentimes'),
        panierMoyenCentimes: ticketsGroupe > 0 ? Math.round(caGroupe / ticketsGroupe) : 0,
        valeurStockCentimes: somme('valeurStockCentimes'),
        valeurEnTransitCentimes: somme('valeurEnTransitCentimes'),
        tresorerieCentimes: somme('tresorerieCentimes') + c(siege?.solde),
        nombreRuptures: somme('nombreRuptures'),
      },
    };
  }
}
