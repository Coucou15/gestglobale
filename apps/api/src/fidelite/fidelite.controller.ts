import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TypeBon } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { FideliteService } from './fidelite.service';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';

class EmettreDto {
  @IsEnum(TypeBon) type: TypeBon;
  @IsInt() @Min(1) montantCentimes: number;
  @IsOptional() @IsInt() @Min(1) nombre?: number;
  @IsOptional() @IsString() expireLe?: string;
  @IsOptional() @IsString() clientId?: string;
}

class ConvertirDto {
  @IsInt() @Min(1) points: number;
  @IsOptional() @IsString() expireLe?: string;
}

class AnnulerDto {
  @IsString() @MinLength(3) motif: string;
}

@ApiTags('M10 — Fidelite et bons d’achat')
@Controller('fidelite')
export class FideliteController {
  constructor(private readonly fidelite: FideliteService) {}

  @Get('bareme')
  @Droits(PERMISSIONS.ARTICLE_VOIR)
  bareme() {
    return this.fidelite.bareme();
  }

  @Get('bons')
  @Droits(PERMISSIONS.TIERS_VOIR)
  bons(
    @Query('actifs') actifs?: string,
    @Query('clientId') clientId?: string,
    @Query('code') code?: string,
  ) {
    return this.fidelite.bons({ actifs: actifs === 'true', clientId, code });
  }

  /** Bons presentes au-dela de leur solde pendant une coupure (M10). */
  @Get('bons/decouverts')
  @Droits(PERMISSIONS.TRESORERIE_VOIR)
  decouverts(@Query('jours') jours?: string) {
    return this.fidelite.decouverts(jours ? Number(jours) : 30);
  }

  @Get('points/:clientId')
  @Droits(PERMISSIONS.TIERS_VOIR)
  points(@Param('clientId') clientId: string) {
    return this.fidelite.valeurPoints(clientId);
  }

  @Post('bons')
  @Droits(PERMISSIONS.TIERS_MODIFIER)
  emettre(@Body() dto: EmettreDto, @Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.fidelite.emettre({ ...dto, utilisateurId: utilisateur.id });
  }

  /** Les points deviennent un bon d'achat : voir FideliteService. */
  @Post('points/:clientId/conversion')
  @Droits(PERMISSIONS.TIERS_MODIFIER)
  convertir(
    @Param('clientId') clientId: string,
    @Body() dto: ConvertirDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.fidelite.convertirPoints({ ...dto, clientId, utilisateurId: utilisateur.id });
  }

  @Post('bons/:id/annulation')
  @Droits(PERMISSIONS.TIERS_BLOQUER)
  annuler(
    @Param('id') id: string,
    @Body() dto: AnnulerDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.fidelite.annuler(id, dto.motif, utilisateur.id);
  }
}
