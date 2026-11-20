import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TypeMouvement } from '@prisma/client';
import { StocksService } from './stocks.service';
import { InventairesService } from './inventaires.service';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';
import { MouvementDto, TransfertDto, SeuilDto, OuvrirInventaireDto, ComptageDto } from './dto';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('M2 — Stocks')
@Controller('stocks')
export class StocksController {
  constructor(
    private readonly stocks: StocksService,
    private readonly inventaires: InventairesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('article/:articleId')
  @Droits(PERMISSIONS.STOCK_VOIR)
  etatArticle(@Param('articleId') articleId: string) {
    return this.stocks.etatArticle(articleId);
  }

  @Get('alertes')
  @Droits(PERMISSIONS.STOCK_VOIR)
  alertes(@Utilisateur() utilisateur: UtilisateurConnecte, @Query('magasinId') magasinId?: string) {
    const magasins = magasinId ? [magasinId] : utilisateur.magasins;
    return this.stocks.alertesReassort(magasins);
  }

  @Get('peremptions')
  @Droits(PERMISSIONS.STOCK_VOIR)
  peremptions(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('jours') jours?: string,
  ) {
    return this.stocks.peremptionsProches(utilisateur.magasins, jours ? Number(jours) : 7);
  }

  /** Stocks passes en negatif : a corriger par un inventaire. */
  @Get('negatifs')
  @Droits(PERMISSIONS.STOCK_VOIR)
  negatifs(@Utilisateur() utilisateur: UtilisateurConnecte, @Query('magasinId') magasinId?: string) {
    return this.stocks.stocksNegatifs(magasinId ? [magasinId] : utilisateur.magasins);
  }

  @Get('mouvements')
  @Droits(PERMISSIONS.STOCK_VOIR)
  mouvements(
    @Query('articleId') articleId?: string,
    @Query('emplacementId') emplacementId?: string,
    @Query('type') type?: TypeMouvement,
    @Query('depuis') depuis?: string,
    @Query('taille') taille?: string,
  ) {
    return this.prisma.mouvementStock.findMany({
      where: {
        ...(articleId ? { articleId } : {}),
        ...(emplacementId ? { emplacementId } : {}),
        ...(type ? { type } : {}),
        ...(depuis ? { date: { gte: new Date(depuis) } } : {}),
      },
      orderBy: { date: 'desc' },
      take: Math.min(Number(taille) || 100, 500),
      include: {
        article: { select: { reference: true, designation: true, unite: true } },
        emplacement: { select: { code: true, nom: true } },
        utilisateur: { select: { code: true, nom: true } },
      },
    });
  }

  /** Casse, peremption, consommation interne : sortie tracee et motivee. */
  @Post('mouvements')
  @Droits(PERMISSIONS.STOCK_CASSE)
  mouvement(@Body() dto: MouvementDto, @Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.stocks.appliquer({ ...dto, utilisateurId: utilisateur.id });
  }

  @Post('transferts')
  @Droits(PERMISSIONS.STOCK_TRANSFERT)
  transferer(@Body() dto: TransfertDto, @Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.stocks.transferer({ ...dto, utilisateurId: utilisateur.id });
  }

  @Put('seuils')
  @Droits(PERMISSIONS.STOCK_VOIR, PERMISSIONS.ARTICLE_MODIFIER)
  async definirSeuil(@Body() dto: SeuilDto) {
    return this.prisma.stock.upsert({
      where: {
        articleId_emplacementId: { articleId: dto.articleId, emplacementId: dto.emplacementId },
      },
      create: {
        articleId: dto.articleId,
        emplacementId: dto.emplacementId,
        quantiteMilli: 0,
        seuilAlerteMilli: dto.seuilAlerteMilli,
        capaciteMilli: dto.capaciteMilli,
      },
      update: { seuilAlerteMilli: dto.seuilAlerteMilli, capaciteMilli: dto.capaciteMilli },
    });
  }

  @Post('inventaires')
  @Droits(PERMISSIONS.STOCK_INVENTAIRE_SAISIR)
  ouvrirInventaire(
    @Body() dto: OuvrirInventaireDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.inventaires.ouvrir({ ...dto, utilisateurId: utilisateur.id });
  }

  /** Inventaires du magasin, le plus recent en tete. */
  @Get('inventaires')
  @Droits(PERMISSIONS.STOCK_INVENTAIRE_SAISIR)
  listerInventaires(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('statut') statut?: string,
  ) {
    return this.prisma.inventaire.findMany({
      where: {
        emplacement: { magasinId: { in: utilisateur.magasins } },
        ...(statut ? { statut: statut as never } : {}),
      },
      orderBy: { debuteLe: 'desc' },
      take: 50,
      include: {
        emplacement: { select: { code: true, nom: true } },
        utilisateurSaisie: { select: { code: true, nom: true } },
        utilisateurValidation: { select: { code: true, nom: true } },
        _count: { select: { lignes: true } },
      },
    });
  }

  @Get('inventaires/:id')
  @Droits(PERMISSIONS.STOCK_INVENTAIRE_SAISIR)
  etatInventaire(@Param('id') id: string) {
    return this.inventaires.etat(id);
  }

  @Post('inventaires/:id/comptage')
  @Droits(PERMISSIONS.STOCK_INVENTAIRE_SAISIR)
  compter(
    @Param('id') id: string,
    @Body() dto: ComptageDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.inventaires.compter(id, dto.lignes, utilisateur.id, dto.source);
  }

  /** Validation reservee a un responsable : genere les ajustements. */
  @Post('inventaires/:id/valider')
  @Droits(PERMISSIONS.STOCK_INVENTAIRE_VALIDER)
  validerInventaire(@Param('id') id: string, @Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.inventaires.valider(id, utilisateur.id, utilisateur.permissions);
  }
}
