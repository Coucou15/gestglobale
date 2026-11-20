import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CategorieOperation, SensMouvementTiers, SensOperation, TypeTiers,
} from '@prisma/client';
import { TiersService } from './tiers.service';
import { TresorerieService } from '../tresorerie/tresorerie.service';
import { PrismaService } from '../prisma/prisma.service';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';
import { b } from '../commun/bigint';
import {
  CreerTiersDto, ModifierTiersDto, BlocageDto, FusionDto, ReglementClientDto,
} from './dto';

@ApiTags('M6 — Tiers')
@Controller('tiers')
export class TiersController {
  constructor(
    private readonly tiers: TiersService,
    private readonly tresorerie: TresorerieService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @Droits(PERMISSIONS.TIERS_VOIR)
  rechercher(
    @Query('texte') texte?: string,
    @Query('type') type?: TypeTiers,
    @Query('bloque') bloque?: string,
    @Query('avecSolde') avecSolde?: string,
    @Query('page') page?: string,
    @Query('taille') taille?: string,
  ) {
    return this.tiers.rechercher({
      texte,
      type,
      bloque: bloque === undefined ? undefined : bloque === 'true',
      avecSolde: avecSolde === 'true',
      page: page ? Number(page) : 1,
      taille: taille ? Number(taille) : 50,
    });
  }

  @Get('impayes')
  @Droits(PERMISSIONS.TIERS_VOIR)
  impayes(@Query('joursRetard') jours?: string) {
    return this.tiers.impayes(jours ? Number(jours) : 0);
  }

  @Get(':id')
  @Droits(PERMISSIONS.TIERS_VOIR)
  parId(@Param('id') id: string) {
    return this.tiers.parId(id);
  }

  @Get(':id/releve')
  @Droits(PERMISSIONS.TIERS_VOIR)
  releve(
    @Param('id') id: string,
    @Query('depuis') depuis?: string,
    @Query('jusqua') jusqua?: string,
  ) {
    return this.tiers.releve(
      id,
      depuis ? new Date(depuis) : undefined,
      jusqua ? new Date(jusqua) : undefined,
    );
  }

  @Get(':id/credit')
  @Droits(PERMISSIONS.TIERS_VOIR)
  credit(@Param('id') id: string, @Query('montantCentimes') montant: string) {
    return this.tiers.evaluerCredit(id, Number(montant) || 0);
  }

  @Post()
  @Droits(PERMISSIONS.TIERS_MODIFIER)
  creer(@Body() dto: CreerTiersDto) {
    return this.prisma.tiers.create({
      data: {
        ...dto,
        plafondCreditCentimes: b(dto.plafondCreditCentimes ?? 0),
      },
    });
  }

  @Patch(':id')
  @Droits(PERMISSIONS.TIERS_MODIFIER)
  modifier(@Param('id') id: string, @Body() dto: ModifierTiersDto) {
    const { plafondCreditCentimes, ...reste } = dto;
    return this.prisma.tiers.update({
      where: { id },
      data: {
        ...reste,
        ...(plafondCreditCentimes !== undefined
          ? { plafondCreditCentimes: b(plafondCreditCentimes) }
          : {}),
      },
    });
  }

  @Post(':id/blocage')
  @Droits(PERMISSIONS.TIERS_BLOQUER)
  bloquer(
    @Param('id') id: string,
    @Body() dto: BlocageDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.tiers.bloquer(id, dto.motif, utilisateur.id);
  }

  @Post(':id/deblocage')
  @Droits(PERMISSIONS.TIERS_BLOQUER)
  debloquer(@Param('id') id: string, @Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.tiers.debloquer(id, utilisateur.id);
  }

  @Post(':id/fusion')
  @Droits(PERMISSIONS.TIERS_MODIFIER)
  fusionner(
    @Param('id') id: string,
    @Body() dto: FusionDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.tiers.fusionner(id, dto.absorbeId, utilisateur.id);
  }

  /** Reglement d'un client : encaissement et diminution de sa dette. */
  @Post(':id/reglement')
  @Droits(PERMISSIONS.TRESORERIE_SAISIR)
  async regler(
    @Param('id') id: string,
    @Body() dto: ReglementClientDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    const client = await this.tiers.parId(id);
    return this.prisma.$transaction(async (tx) => {
      await this.tresorerie.enregistrer(
        {
          compteId: dto.compteId,
          sens: SensOperation.ENTREE,
          categorie: CategorieOperation.REGLEMENT_CLIENT,
          montantCentimes: dto.montantCentimes,
          libelle: `Reglement client ${client.raisonSociale}`,
          tiersId: id,
          utilisateurId: utilisateur.id,
        },
        tx,
      );
      return this.tiers.enregistrerMouvement(
        {
          tiersId: id,
          sens: SensMouvementTiers.CREDIT,
          montantCentimes: dto.montantCentimes,
          categorie: 'REGLEMENT',
          libelle: dto.reference ? `Reglement ${dto.reference}` : 'Reglement client',
          utilisateurId: utilisateur.id,
        },
        tx,
      );
    });
  }
}
