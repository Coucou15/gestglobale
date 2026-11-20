import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { StatutInventaire, TypeInventaire, TypeMouvement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumerotationService } from '../commun/numerotation.service';
import { AuditService } from '../audit/audit.service';
import { StocksService } from './stocks.service';
import { b, c } from '../commun/bigint';

/**
 * Inventaires tournants et complets (M2).
 *
 * Le comptage ne touche jamais le stock : c'est la validation par un
 * responsable qui genere les ajustements, chacun trace comme un mouvement
 * ordinaire. L'ecart est valorise au CUMP avant validation, pour que le
 * gerant sache ce qu'il signe.
 */
@Injectable()
export class InventairesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numerotation: NumerotationService,
    private readonly audit: AuditService,
    private readonly stocks: StocksService,
  ) {}

  /**
   * Ouvre un inventaire et fige les quantites theoriques du perimetre.
   * Les articles absents du stock sont inclus avec un theorique a 0 : c'est
   * ainsi qu'un article "trouve en rayon" mais inconnu remonte.
   */
  async ouvrir(params: {
    emplacementId: string;
    type: TypeInventaire;
    libelle?: string;
    rayonId?: string;
    familleId?: string;
    utilisateurId: string;
  }) {
    const enCours = await this.prisma.inventaire.findFirst({
      where: {
        emplacementId: params.emplacementId,
        statut: { in: [StatutInventaire.BROUILLON, StatutInventaire.EN_SAISIE, StatutInventaire.A_VALIDER] },
      },
    });
    if (enCours) {
      throw new BadRequestException(
        `Un inventaire est deja en cours sur cet emplacement : ${enCours.numero}`,
      );
    }

    const numero = await this.numerotation.suivant('INV');
    const perimetre = {
      ...(params.rayonId ? { rayonId: params.rayonId } : {}),
      ...(params.familleId ? { familleId: params.familleId } : {}),
    };

    const articles = await this.prisma.article.findMany({
      where: {
        archive: false,
        ...(params.rayonId ? { rayonId: params.rayonId } : {}),
        ...(params.familleId ? { familleId: params.familleId } : {}),
        ...(params.type === TypeInventaire.TOURNANT
          ? { stocks: { some: { emplacementId: params.emplacementId } } }
          : {}),
      },
      select: {
        id: true,
        cumpCentimes: true,
        stocks: { where: { emplacementId: params.emplacementId }, select: { quantiteMilli: true } },
      },
    });

    const inventaire = await this.prisma.inventaire.create({
      data: {
        numero,
        emplacementId: params.emplacementId,
        type: params.type,
        statut: StatutInventaire.EN_SAISIE,
        libelle: params.libelle,
        perimetre: Object.keys(perimetre).length ? perimetre : undefined,
        utilisateurSaisieId: params.utilisateurId,
        lignes: {
          create: articles.map((a) => ({
            articleId: a.id,
            quantiteTheoriqueMilli: a.stocks[0]?.quantiteMilli ?? 0,
            cumpCentimes: a.cumpCentimes,
          })),
        },
      },
      include: { _count: { select: { lignes: true } } },
    });

    await this.audit.journaliser({
      utilisateurId: params.utilisateurId,
      action: 'inventaire.ouverture',
      entite: 'Inventaire',
      entiteId: inventaire.id,
      details: { numero, lignes: inventaire._count.lignes },
    });
    return inventaire;
  }

  /** Saisie d'un comptage, typiquement depuis un terminal mobile. */
  async compter(
    inventaireId: string,
    lignes: Array<{ articleId: string; quantiteCompteeMilli: number }>,
    utilisateurId: string,
    source = 'terminal',
  ) {
    const inventaire = await this.prisma.inventaire.findUnique({ where: { id: inventaireId } });
    if (!inventaire) throw new NotFoundException('Inventaire introuvable');
    if (inventaire.statut === StatutInventaire.VALIDE || inventaire.statut === StatutInventaire.ANNULE) {
      throw new BadRequestException('Cet inventaire est cloture');
    }

    let traitees = 0;
    for (const ligne of lignes) {
      const existante = await this.prisma.ligneInventaire.findUnique({
        where: { inventaireId_articleId: { inventaireId, articleId: ligne.articleId } },
      });

      // Un article compte mais absent du perimetre est ajoute : c'est le cas
      // d'un produit trouve en rayon et oublie du stock.
      if (!existante) {
        const article = await this.prisma.article.findUnique({
          where: { id: ligne.articleId },
          select: { cumpCentimes: true },
        });
        if (!article) continue;
        await this.prisma.ligneInventaire.create({
          data: {
            inventaireId,
            articleId: ligne.articleId,
            quantiteTheoriqueMilli: 0,
            quantiteCompteeMilli: ligne.quantiteCompteeMilli,
            ecartMilli: ligne.quantiteCompteeMilli,
            cumpCentimes: article.cumpCentimes,
            ecartValoriseCentimes: b(
              Math.round((ligne.quantiteCompteeMilli * c(article.cumpCentimes)) / 1000),
            ),
            sourceSaisie: source,
            compteeLe: new Date(),
          },
        });
        traitees++;
        continue;
      }

      const ecart = ligne.quantiteCompteeMilli - existante.quantiteTheoriqueMilli;
      await this.prisma.ligneInventaire.update({
        where: { id: existante.id },
        data: {
          quantiteCompteeMilli: ligne.quantiteCompteeMilli,
          ecartMilli: ecart,
          ecartValoriseCentimes: b(Math.round((ecart * c(existante.cumpCentimes)) / 1000)),
          sourceSaisie: source,
          compteeLe: new Date(),
        },
      });
      traitees++;
    }

    await this.recalculerEcart(inventaireId);
    return { traitees };
  }

  private async recalculerEcart(inventaireId: string): Promise<number> {
    const somme = await this.prisma.ligneInventaire.aggregate({
      where: { inventaireId, quantiteCompteeMilli: { not: null } },
      _sum: { ecartValoriseCentimes: true },
    });
    const total = c(somme._sum.ecartValoriseCentimes);
    await this.prisma.inventaire.update({
      where: { id: inventaireId },
      data: { ecartValoriseCentimes: b(total) },
    });
    return total;
  }

  /** Etat de l'inventaire : ce que le responsable lit avant de valider. */
  async etat(inventaireId: string) {
    const inventaire = await this.prisma.inventaire.findUnique({
      where: { id: inventaireId },
      include: {
        emplacement: { include: { magasin: { select: { code: true, nom: true } } } },
        utilisateurSaisie: { select: { code: true, nom: true } },
        utilisateurValidation: { select: { code: true, nom: true } },
      },
    });
    if (!inventaire) throw new NotFoundException('Inventaire introuvable');

    const [comptees, total, ecarts] = await Promise.all([
      this.prisma.ligneInventaire.count({
        where: { inventaireId, quantiteCompteeMilli: { not: null } },
      }),
      this.prisma.ligneInventaire.count({ where: { inventaireId } }),
      this.prisma.ligneInventaire.findMany({
        where: { inventaireId, ecartMilli: { not: 0 }, quantiteCompteeMilli: { not: null } },
        orderBy: { ecartValoriseCentimes: 'asc' },
        take: 500,
        include: { article: { select: { reference: true, designation: true, unite: true } } },
      }),
    ]);

    return {
      inventaire,
      avancement: { comptees, total, restantes: total - comptees },
      ecarts,
    };
  }

  /**
   * Validation : genere un mouvement d'ajustement par ligne en ecart.
   * Reservee a un responsable (droit stock.inventaire_valider).
   */
  async valider(inventaireId: string, utilisateurId: string, permissions: string[]) {
    if (!permissions.includes('stock.inventaire_valider')) {
      throw new ForbiddenException("La validation d'un inventaire exige un responsable");
    }

    const inventaire = await this.prisma.inventaire.findUnique({ where: { id: inventaireId } });
    if (!inventaire) throw new NotFoundException('Inventaire introuvable');
    if (inventaire.statut === StatutInventaire.VALIDE) {
      throw new BadRequestException('Inventaire deja valide');
    }

    const lignes = await this.prisma.ligneInventaire.findMany({
      where: { inventaireId, quantiteCompteeMilli: { not: null }, ecartMilli: { not: 0 } },
    });

    let ajustements = 0;
    for (const ligne of lignes) {
      await this.stocks.appliquer({
        type: TypeMouvement.AJUSTEMENT_INVENTAIRE,
        articleId: ligne.articleId,
        emplacementId: inventaire.emplacementId,
        quantiteMilli: ligne.ecartMilli,
        documentType: 'INVENTAIRE',
        documentId: inventaire.id,
        documentNumero: inventaire.numero,
        motif: `Ajustement inventaire ${inventaire.numero}`,
        utilisateurId,
      });
      ajustements++;
    }

    const ecartTotal = await this.recalculerEcart(inventaireId);
    const valide = await this.prisma.inventaire.update({
      where: { id: inventaireId },
      data: {
        statut: StatutInventaire.VALIDE,
        clotureLe: new Date(),
        utilisateurValidationId: utilisateurId,
      },
    });

    await this.audit.journaliser({
      utilisateurId,
      action: 'inventaire.validation',
      entite: 'Inventaire',
      entiteId: inventaireId,
      details: { numero: inventaire.numero, ajustements, ecartValoriseCentimes: ecartTotal },
    });

    return { inventaire: valide, ajustements, ecartValoriseCentimes: ecartTotal };
  }
}
