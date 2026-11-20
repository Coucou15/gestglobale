import { IsString, IsInt, IsOptional, IsEnum, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { TypeInventaire, TypeMouvement } from '@prisma/client';

export class MouvementDto {
  @IsEnum(TypeMouvement) type: TypeMouvement;
  @IsString() articleId: string;
  @IsString() emplacementId: string;
  /** Signee : positive pour une entree, negative pour une sortie. */
  @IsInt() quantiteMilli: number;
  @IsOptional() @IsInt() @Min(0) prixAchatCentimes?: number;
  @IsOptional() @IsString() motif?: string;
}

export class TransfertDto {
  @IsString() articleId: string;
  @IsString() sourceId: string;
  @IsString() destinationId: string;
  @IsInt() @Min(1) quantiteMilli: number;
  @IsOptional() @IsString() motif?: string;
}

export class SeuilDto {
  @IsString() articleId: string;
  @IsString() emplacementId: string;
  @IsInt() @Min(0) seuilAlerteMilli: number;
  @IsOptional() @IsInt() @Min(0) capaciteMilli?: number;
}

export class OuvrirInventaireDto {
  @IsString() emplacementId: string;
  @IsEnum(TypeInventaire) type: TypeInventaire;
  @IsOptional() @IsString() libelle?: string;
  @IsOptional() @IsString() rayonId?: string;
  @IsOptional() @IsString() familleId?: string;
}

export class LigneComptageDto {
  @IsString() articleId: string;
  @IsInt() quantiteCompteeMilli: number;
}

export class ComptageDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => LigneComptageDto)
  lignes: LigneComptageDto[];

  @IsOptional() @IsString() source?: string;
}
