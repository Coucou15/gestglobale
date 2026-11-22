import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { StatutTransfertStock } from '@prisma/client';
import {
  ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Min, MinLength, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TransfertsService } from './transferts.service';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';

class LigneExpeditionDto {
  @IsString() articleId: string;
  @IsInt() @Min(1) quantiteMilli: number;
}

class PreparerDto {
  @IsString() magasinDestinationId: string;
  @IsString() emplacementSourceId: string;
  @IsString() emplacementDestinationId: string;
  @IsOptional() @IsString() magasinSourceId?: string;
  @IsOptional() @IsString() motif?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true })
  @Type(() => LigneExpeditionDto)
  lignes: LigneExpeditionDto[];
}

class LigneReceptionDto {
  @IsString() articleId: string;
  @IsInt() @Min(0) quantiteRecueMilli: number;
  @IsOptional() @IsString() motifEcart?: string;
}

class ReceptionnerDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => LigneReceptionDto)
  lignes: LigneReceptionDto[];
  @IsOptional() @IsString() commentaire?: string;
}

class AnnulerDto {
  @IsString() @MinLength(3) motif: string;
}

@ApiTags('M11 — Transferts inter-magasins')
@Controller('transferts')
export class TransfertsController {
  constructor(private readonly transferts: TransfertsService) {}

  @Get()
  @Droits(PERMISSIONS.STOCK_VOIR)
  liste(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('statut') statut?: string,
    @Query('limite') limite?: string,
  ) {
    if (statut && !(statut in StatutTransfertStock)) {
      throw new BadRequestException(
        `Statut « ${statut} » inconnu : PREPARE, EXPEDIE, RECU ou ANNULE`,
      );
    }
    return this.transferts.liste({
      magasinIds: utilisateur.magasins,
      statut: statut as StatutTransfertStock | undefined,
      limite: limite ? Number(limite) : undefined,
    });
  }

  /** Marchandise partie et pas encore arrivee : de l'argent sur la route. */
  @Get('en-transit')
  @Droits(PERMISSIONS.STOCK_VOIR)
  enTransit(@Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.transferts.enTransit(utilisateur.magasins);
  }

  @Get(':id')
  @Droits(PERMISSIONS.STOCK_VOIR)
  parId(@Utilisateur() utilisateur: UtilisateurConnecte, @Param('id') id: string) {
    return this.transferts.parId(id, utilisateur.magasins);
  }

  @Post()
  @Droits(PERMISSIONS.STOCK_TRANSFERT)
  preparer(@Utilisateur() utilisateur: UtilisateurConnecte, @Body() dto: PreparerDto) {
    const magasinSourceId = dto.magasinSourceId ?? utilisateur.magasins[0];
    if (!magasinSourceId || !utilisateur.magasins.includes(magasinSourceId)) {
      throw new BadRequestException('Le magasin expediteur ne fait pas partie des votres');
    }
    return this.transferts.preparer({
      ...dto,
      magasinSourceId,
      utilisateurId: utilisateur.id,
    });
  }

  @Post(':id/expedition')
  @Droits(PERMISSIONS.STOCK_TRANSFERT)
  expedier(@Utilisateur() utilisateur: UtilisateurConnecte, @Param('id') id: string) {
    return this.transferts.expedier(id, utilisateur.id);
  }

  @Post(':id/reception')
  @Droits(PERMISSIONS.STOCK_TRANSFERT)
  receptionner(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Param('id') id: string,
    @Body() dto: ReceptionnerDto,
  ) {
    return this.transferts.receptionner({ id, ...dto, utilisateurId: utilisateur.id });
  }

  @Post(':id/annulation')
  @Droits(PERMISSIONS.STOCK_TRANSFERT)
  annuler(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Param('id') id: string,
    @Body() dto: AnnulerDto,
  ) {
    return this.transferts.annuler(id, dto.motif, utilisateur.id);
  }
}
