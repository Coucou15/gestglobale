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

    const [totaux, parJour, parMode, parCaissier] = await Promise.all([
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
}
