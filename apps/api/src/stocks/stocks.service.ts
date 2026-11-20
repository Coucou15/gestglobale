import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TypeMouvement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumerotationService } from '../commun/numerotation.service';
import { AuditService } from '../audit/audit.service';
import { b, c } from '../commun/bigint';
import { recalculerCump } from '@gestglobale/shared';

export interface DemandeMouvement {
  type: TypeMouvement;
  articleId: string;
  emplacementId: string;
  /** Signee : positive pour une entree, negative pour une sortie. */
  quantiteMilli: number;
  /** Prix d'achat unitaire pour une entree valorisee (reception). */
  prixAchatCentimes?: number;
  lotId?: string | null;
  documentType?: string;
  documentId?: string;
  documentNumero?: string;
  motif?: string;
  utilisateurId: string;
  caisseId?: string | null;
  date?: Date;
}

/** Types de mouvement qui recalculent le CUMP de l'article. */
const ENTREES_VALORISEES: TypeMouvement[] = [
  TypeMouvement.RECEPTION,
  TypeMouvement.SOLDE_INITIAL,
];

@Injectable()
export class StocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numerotation: NumerotationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Applique un mouvement de stock.
   *
   * Invariants garantis ici, et nulle part ailleurs :
   *  - le stock de l'emplacement et la ligne de mouvement bougent dans la
   *    meme transaction : la somme des mouvements egale toujours le stock ;
   *  - le stock negatif est refuse si le parametre l'interdit (M2) ;
   *  - une entree valorisee recalcule le CUMP de l'article avant d'ecrire
   *    le mouvement, pour que la ligne porte la valeur exacte du moment.
   *
   * A appeler depuis une transaction appelante quand plusieurs mouvements
   * doivent reussir ou echouer ensemble (reception, ticket, transfert).
   */
  async appliquer(
    demande: DemandeMouvement,
    tx?: Prisma.TransactionClient,
  ): Promise<{ numero: string; stockApresMilli: number; cumpCentimes: number }> {
    if (tx) return this.appliquerDans(tx, demande);
    return this.prisma.$transaction((client) => this.appliquerDans(client, demande));
  }

  private async appliquerDans(
    tx: Prisma.TransactionClient,
    demande: DemandeMouvement,
  ): Promise<{ numero: string; stockApresMilli: number; cumpCentimes: number }> {
    if (demande.quantiteMilli === 0) {
      throw new BadRequestException('Un mouvement de stock ne peut pas etre de quantite nulle');
    }

    const article = await tx.article.findUnique({
      where: { id: demande.articleId },
      select: { id: true, reference: true, cumpCentimes: true, designation: true },
    });
    if (!article) throw new NotFoundException(`Article introuvable : ${demande.articleId}`);

    // Verrou sur la ligne de stock : deux ventes simultanees du meme
    // article ne peuvent pas lire le meme stock de depart.
    const stockExistant = await tx.$queryRaw<Array<{ id: string; quantiteMilli: number }>>`
      SELECT "id", "quantiteMilli" FROM "Stock"
      WHERE "articleId" = ${demande.articleId} AND "emplacementId" = ${demande.emplacementId}
      FOR UPDATE`;

    const stockAvant = stockExistant[0]?.quantiteMilli ?? 0;
    const stockApres = stockAvant + demande.quantiteMilli;

    if (stockApres < 0 && !(await this.stockNegatifAutorise(tx, demande.emplacementId))) {
      throw new BadRequestException(
        `Stock insuffisant pour ${article.reference} — ${article.designation} : ` +
          `${stockAvant / 1000} disponible, ${Math.abs(demande.quantiteMilli) / 1000} demande`,
      );
    }

    // CUMP : recalcule seulement sur une entree valorisee.
    let cump = c(article.cumpCentimes);
    const estEntreeValorisee =
      ENTREES_VALORISEES.includes(demande.type) &&
      demande.quantiteMilli > 0 &&
      demande.prixAchatCentimes !== undefined;

    if (estEntreeValorisee) {
      // Le CUMP est porte par l'article, donc calcule sur le stock total
      // tous emplacements confondus : un transfert interne ne doit pas
      // modifier la valorisation.
      const total = await tx.stock.aggregate({
        where: { articleId: demande.articleId },
        _sum: { quantiteMilli: true },
      });
      cump = recalculerCump(
        { stockMilli: total._sum.quantiteMilli ?? 0, cumpCentimes: cump },
        {
          quantiteMilli: demande.quantiteMilli,
          prixAchatCentimes: demande.prixAchatCentimes as number,
        },
      );
      await tx.article.update({
        where: { id: demande.articleId },
        data: {
          cumpCentimes: b(cump),
          dernierPrixAchatCentimes: b(demande.prixAchatCentimes as number),
        },
      });
    }

    if (stockExistant.length === 0) {
      await tx.stock.create({
        data: {
          articleId: demande.articleId,
          emplacementId: demande.emplacementId,
          quantiteMilli: stockApres,
          derniereEntree: demande.quantiteMilli > 0 ? new Date() : null,
          derniereSortie: demande.quantiteMilli < 0 ? new Date() : null,
        },
      });
    } else {
      await tx.stock.update({
        where: { id: stockExistant[0].id },
        data: {
          quantiteMilli: stockApres,
          ...(demande.quantiteMilli > 0
            ? { derniereEntree: new Date() }
            : { derniereSortie: new Date() }),
        },
      });
    }

    const numero = await this.numerotation.suivant('MVT', { tx });
    await tx.mouvementStock.create({
      data: {
        numero,
        type: demande.type,
        articleId: demande.articleId,
        emplacementId: demande.emplacementId,
        quantiteMilli: demande.quantiteMilli,
        stockApresMilli: stockApres,
        cumpCentimes: b(cump),
        valeurCentimes: b(Math.round((demande.quantiteMilli * cump) / 1000)),
        lotId: demande.lotId ?? null,
        documentType: demande.documentType ?? null,
        documentId: demande.documentId ?? null,
        documentNumero: demande.documentNumero ?? null,
        motif: demande.motif ?? null,
        utilisateurId: demande.utilisateurId,
        caisseId: demande.caisseId ?? null,
        date: demande.date ?? new Date(),
      },
    });

    if (demande.lotId) {
      await tx.lot.update({
        where: { id: demande.lotId },
        data: { quantiteMilli: { increment: demande.quantiteMilli } },
      });
    }

    return { numero, stockApresMilli: stockApres, cumpCentimes: cump };
  }

  private async stockNegatifAutorise(
    tx: Prisma.TransactionClient,
    emplacementId: string,
  ): Promise<boolean> {
    const emplacement = await tx.emplacement.findUnique({
      where: { id: emplacementId },
      select: { magasinId: true },
    });
    const parametre = await tx.parametre.findFirst({
      where: { cle: 'stock.negatif_autorise', magasinId: emplacement?.magasinId ?? null },
    });
    const global = parametre
      ? parametre
      : await tx.parametre.findFirst({ where: { cle: 'stock.negatif_autorise', magasinId: null } });
    return global?.valeur === true;
  }

  /**
   * Transfert entre deux emplacements : une sortie et une entree liees par
   * le meme numero de document, dans une seule transaction (M2, M11).
   */
  async transferer(params: {
    articleId: string;
    sourceId: string;
    destinationId: string;
    quantiteMilli: number;
    motif?: string;
    utilisateurId: string;
  }): Promise<{ numero: string }> {
    if (params.quantiteMilli <= 0) {
      throw new BadRequestException('La quantite a transferer doit etre positive');
    }
    if (params.sourceId === params.destinationId) {
      throw new BadRequestException('Les emplacements source et destination sont identiques');
    }

    return this.prisma.$transaction(async (tx) => {
      const numero = await this.numerotation.suivant('TRF', { tx });
      await this.appliquerDans(tx, {
        type: TypeMouvement.TRANSFERT_SORTIE,
        articleId: params.articleId,
        emplacementId: params.sourceId,
        quantiteMilli: -params.quantiteMilli,
        documentType: 'TRANSFERT',
        documentNumero: numero,
        motif: params.motif,
        utilisateurId: params.utilisateurId,
      });
      await this.appliquerDans(tx, {
        type: TypeMouvement.TRANSFERT_ENTREE,
        articleId: params.articleId,
        emplacementId: params.destinationId,
        quantiteMilli: params.quantiteMilli,
        documentType: 'TRANSFERT',
        documentNumero: numero,
        motif: params.motif,
        utilisateurId: params.utilisateurId,
      });
      return { numero };
    });
  }

  /** Etat du stock d'un article, par emplacement. */
  async etatArticle(articleId: string) {
    const [article, stocks] = await Promise.all([
      this.prisma.article.findUnique({
        where: { id: articleId },
        select: { id: true, reference: true, designation: true, unite: true, cumpCentimes: true },
      }),
      this.prisma.stock.findMany({
        where: { articleId },
        include: { emplacement: { include: { magasin: { select: { code: true, nom: true } } } } },
      }),
    ]);
    if (!article) throw new NotFoundException('Article introuvable');

    const totalMilli = stocks.reduce((t, s) => t + s.quantiteMilli, 0);
    return {
      article,
      totalMilli,
      valeurCentimes: Math.round((totalMilli * c(article.cumpCentimes)) / 1000),
      emplacements: stocks.map((s) => ({
        emplacementId: s.emplacementId,
        code: s.emplacement.code,
        nom: s.emplacement.nom,
        type: s.emplacement.type,
        magasin: s.emplacement.magasin,
        quantiteMilli: s.quantiteMilli,
        seuilAlerteMilli: s.seuilAlerteMilli,
        sousSeuil: s.quantiteMilli <= s.seuilAlerteMilli && s.seuilAlerteMilli > 0,
      })),
    };
  }

  /** Articles sous leur seuil d'alerte : propose le reassort (M2). */
  async alertesReassort(magasinIds: string[], limite = 200) {
    const lignes = await this.prisma.$queryRaw<
      Array<{
        articleId: string;
        reference: string;
        designation: string;
        emplacementId: string;
        emplacement: string;
        quantiteMilli: number;
        seuilAlerteMilli: number;
        capaciteMilli: number | null;
        stockDepotMilli: number | null;
      }>
    >`
      SELECT a."id"            AS "articleId",
             a."reference",
             a."designation",
             e."id"            AS "emplacementId",
             e."nom"           AS "emplacement",
             s."quantiteMilli",
             s."seuilAlerteMilli",
             s."capaciteMilli",
             (SELECT SUM(sd."quantiteMilli")::int
                FROM "Stock" sd
                JOIN "Emplacement" ed ON ed."id" = sd."emplacementId"
               WHERE sd."articleId" = a."id"
                 AND ed."magasinId" = e."magasinId"
                 AND ed."type" = 'DEPOT') AS "stockDepotMilli"
        FROM "Stock" s
        JOIN "Article" a ON a."id" = s."articleId"
        JOIN "Emplacement" e ON e."id" = s."emplacementId"
       WHERE e."magasinId" = ANY(${magasinIds}::text[])
         AND s."seuilAlerteMilli" > 0
         AND s."quantiteMilli" <= s."seuilAlerteMilli"
         AND a."archive" = false
       ORDER BY (s."seuilAlerteMilli" - s."quantiteMilli") DESC
       LIMIT ${limite}`;

    return lignes.map((l) => {
      const cible = l.capaciteMilli ?? l.seuilAlerteMilli * 2;
      const aReassortir = Math.max(0, cible - l.quantiteMilli);
      const depuisDepot = Math.min(aReassortir, Math.max(0, l.stockDepotMilli ?? 0));
      return {
        ...l,
        aReassortirMilli: aReassortir,
        // Ce qui peut venir du depot, et ce qu'il faut commander au fournisseur.
        depuisDepotMilli: depuisDepot,
        aCommanderMilli: aReassortir - depuisDepot,
      };
    });
  }

  /** Lots arrivant a peremption (M2). */
  async peremptionsProches(magasinIds: string[], joursParDefaut = 7) {
    const limite = new Date();
    limite.setDate(limite.getDate() + joursParDefaut);

    return this.prisma.lot.findMany({
      where: {
        quantiteMilli: { gt: 0 },
        datePeremption: { not: null, lte: limite },
        emplacement: { magasinId: { in: magasinIds } },
      },
      orderBy: { datePeremption: 'asc' },
      include: {
        article: { select: { reference: true, designation: true, unite: true } },
        emplacement: { select: { nom: true, magasinId: true } },
      },
      take: 500,
    });
  }
}
