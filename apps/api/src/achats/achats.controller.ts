import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AchatsService } from './achats.service';
import { PrismaService } from '../prisma/prisma.service';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';
import { verifierAccesMagasin } from '../auth/magasin.util';
import {
  CreerCommandeDto, CreerReceptionDto, ValiderReceptionDto, ReglerFactureDto,
} from './dto';

@ApiTags('M3 — Achats')
@Controller('achats')
export class AchatsController {
  constructor(
    private readonly achats: AchatsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('commandes')
  @Droits(PERMISSIONS.ACHAT_VOIR)
  commandes(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('statut') statut?: string,
    @Query('fournisseurId') fournisseurId?: string,
  ) {
    return this.prisma.commandeFournisseur.findMany({
      where: {
        magasinId: { in: utilisateur.magasins },
        ...(statut ? { statut: statut as never } : {}),
        ...(fournisseurId ? { fournisseurId } : {}),
      },
      orderBy: { dateCommande: 'desc' },
      take: 100,
      include: {
        fournisseur: { select: { code: true, raisonSociale: true } },
        _count: { select: { lignes: true } },
      },
    });
  }

  @Post('commandes')
  @Droits(PERMISSIONS.ACHAT_COMMANDER)
  creerCommande(@Body() dto: CreerCommandeDto, @Utilisateur() utilisateur: UtilisateurConnecte) {
    verifierAccesMagasin(utilisateur, dto.magasinId);
    return this.achats.creerCommande({ ...dto, utilisateurId: utilisateur.id });
  }

  @Get('receptions')
  @Droits(PERMISSIONS.ACHAT_VOIR)
  receptions(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('statut') statut?: string,
  ) {
    return this.prisma.reception.findMany({
      where: {
        magasinId: { in: utilisateur.magasins },
        ...(statut ? { statut: statut as never } : {}),
      },
      orderBy: { dateReception: 'desc' },
      take: 100,
      include: {
        fournisseur: { select: { code: true, raisonSociale: true } },
        emplacement: { select: { code: true, nom: true } },
        _count: { select: { lignes: true } },
      },
    });
  }

  @Get('receptions/:id')
  @Droits(PERMISSIONS.ACHAT_VOIR)
  reception(@Param('id') id: string) {
    return this.prisma.reception.findUniqueOrThrow({
      where: { id },
      include: {
        lignes: { include: { article: { select: { reference: true, designation: true, unite: true } } } },
        fournisseur: true,
        emplacement: true,
      },
    });
  }

  /** Cree la reception en brouillon : aucun stock ne bouge encore. */
  @Post('receptions')
  @Droits(PERMISSIONS.STOCK_RECEPTION)
  creerReception(@Body() dto: CreerReceptionDto, @Utilisateur() utilisateur: UtilisateurConnecte) {
    verifierAccesMagasin(utilisateur, dto.magasinId);
    return this.achats.creerReception({ ...dto, utilisateurId: utilisateur.id });
  }

  /** Validation : entree en stock, CUMP recalcule, dette ou paiement. */
  @Post('receptions/:id/valider')
  @Droits(PERMISSIONS.STOCK_RECEPTION)
  validerReception(
    @Param('id') id: string,
    @Body() dto: ValiderReceptionDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.achats.validerReception(id, { ...dto, utilisateurId: utilisateur.id });
  }

  @Get('factures')
  @Droits(PERMISSIONS.ACHAT_VOIR)
  factures(@Query('fournisseurId') fournisseurId?: string, @Query('impayees') impayees?: string) {
    return this.prisma.factureAchat.findMany({
      where: {
        ...(fournisseurId ? { fournisseurId } : {}),
        ...(impayees === 'true' ? { regleCentimes: { equals: 0 } } : {}),
      },
      orderBy: { dateFacture: 'desc' },
      take: 200,
      include: { fournisseur: { select: { code: true, raisonSociale: true } } },
    });
  }

  @Post('factures/:id/reglement')
  @Droits(PERMISSIONS.ACHAT_FACTURER)
  reglerFacture(
    @Param('id') id: string,
    @Body() dto: ReglerFactureDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.achats.reglerFacture({ factureId: id, ...dto, utilisateurId: utilisateur.id });
  }

  /** Historique et comparaison des fournisseurs sur un article (M3). */
  @Get('comparaison/:articleId')
  @Droits(PERMISSIONS.ACHAT_VOIR)
  comparer(@Param('articleId') articleId: string) {
    return this.achats.comparerFournisseurs(articleId);
  }
}
