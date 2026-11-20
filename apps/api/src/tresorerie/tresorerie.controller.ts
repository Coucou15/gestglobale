import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CategorieOperation } from '@prisma/client';
import { TresorerieService } from './tresorerie.service';
import { PrismaService } from '../prisma/prisma.service';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';
import { CreerCompteDto, OperationDto, TransfertDto, RefusDto, PointageDto } from './dto';

@ApiTags('M7 — Tresorerie')
@Controller('tresorerie')
export class TresorerieController {
  constructor(
    private readonly tresorerie: TresorerieService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('situation')
  @Droits(PERMISSIONS.TRESORERIE_VOIR)
  situation(@Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.tresorerie.situation(utilisateur.magasins);
  }

  @Get('journal')
  @Droits(PERMISSIONS.TRESORERIE_VOIR)
  journal(
    @Query('compteId') compteId?: string,
    @Query('categorie') categorie?: CategorieOperation,
    @Query('depuis') depuis?: string,
    @Query('jusqua') jusqua?: string,
    @Query('pointee') pointee?: string,
    @Query('taille') taille?: string,
  ) {
    return this.tresorerie.journal({
      compteId,
      categorie,
      depuis: depuis ? new Date(depuis) : undefined,
      jusqua: jusqua ? new Date(jusqua) : undefined,
      pointee: pointee === undefined ? undefined : pointee === 'true',
      taille: taille ? Number(taille) : 200,
    });
  }

  @Post('comptes')
  @Droits(PERMISSIONS.PARAMETRE_MODIFIER)
  creerCompte(@Body() dto: CreerCompteDto) {
    return this.prisma.compteTresorerie.create({ data: dto });
  }

  /** Depense, salaire, apport ou retrait du gerant. */
  @Post('operations')
  @Droits(PERMISSIONS.TRESORERIE_SAISIR)
  operation(@Body() dto: OperationDto, @Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.tresorerie.enregistrer({
      ...dto,
      date: dto.date ? new Date(dto.date) : undefined,
      utilisateurId: utilisateur.id,
    });
  }

  @Get('transferts')
  @Droits(PERMISSIONS.TRESORERIE_VOIR)
  transferts(@Query('statut') statut?: string) {
    return this.prisma.transfertTresorerie.findMany({
      where: statut ? { statut: statut as never } : {},
      orderBy: { demandeLe: 'desc' },
      take: 100,
      include: {
        compteSource: { select: { code: true, libelle: true } },
        compteDestination: { select: { code: true, libelle: true } },
        demandePar: { select: { code: true, nom: true } },
        validePar: { select: { code: true, nom: true } },
      },
    });
  }

  @Post('transferts')
  @Droits(PERMISSIONS.TRESORERIE_SAISIR)
  demanderTransfert(@Body() dto: TransfertDto, @Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.tresorerie.demanderTransfert({ ...dto, utilisateurId: utilisateur.id });
  }

  /** Double validation : le demandeur ne peut pas valider lui-meme. */
  @Post('transferts/:id/valider')
  @Droits(PERMISSIONS.TRESORERIE_VALIDER_TRANSFERT)
  validerTransfert(@Param('id') id: string, @Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.tresorerie.validerTransfert(id, utilisateur.id);
  }

  @Post('transferts/:id/refuser')
  @Droits(PERMISSIONS.TRESORERIE_VALIDER_TRANSFERT)
  refuserTransfert(
    @Param('id') id: string,
    @Body() dto: RefusDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.tresorerie.refuserTransfert(id, dto.commentaire, utilisateur.id);
  }

  @Post('pointage')
  @Droits(PERMISSIONS.TRESORERIE_SAISIR)
  pointer(@Body() dto: PointageDto) {
    return this.tresorerie.pointer(dto.operationIds, dto.pointee);
  }
}
