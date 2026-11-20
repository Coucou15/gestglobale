import {
  IsString, IsInt, IsOptional, IsArray, ValidateNested, IsEnum, IsBoolean, Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ModeReglementAchat, TypeReception } from '@prisma/client';

export class LigneCommandeDto {
  @IsString() articleId: string;
  @IsInt() @Min(1) quantiteMilli: number;
  @IsInt() @Min(0) prixAchatCentimes: number;
  @IsOptional() @IsInt() @Min(0) remisePourcent?: number;
  @IsOptional() @IsInt() @Min(0) tauxTva?: number;
}

export class CreerCommandeDto {
  @IsString() fournisseurId: string;
  @IsString() magasinId: string;
  @IsOptional() @IsString() dateLivraisonPrevue?: string;
  @IsOptional() @IsString() observation?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => LigneCommandeDto)
  lignes: LigneCommandeDto[];
}

export class LigneReceptionDto extends LigneCommandeDto {
  @IsOptional() @IsString() lotNumero?: string;
  @IsOptional() @IsString() datePeremption?: string;
  @IsOptional() @IsInt() @Min(0) prixVenteAppliqueCentimes?: number;
}

export class CreerReceptionDto {
  @IsString() fournisseurId: string;
  @IsString() magasinId: string;
  @IsString() emplacementId: string;
  @IsOptional() @IsString() commandeId?: string;
  @IsOptional() @IsString() numeroBonFournisseur?: string;
  @IsOptional() @IsEnum(TypeReception) type?: TypeReception;
  @IsArray() @ValidateNested({ each: true }) @Type(() => LigneReceptionDto)
  lignes: LigneReceptionDto[];
}

export class ValiderReceptionDto {
  @IsOptional() @IsEnum(ModeReglementAchat) modeReglement?: ModeReglementAchat;
  @IsOptional() @IsString() compteId?: string;
  @IsOptional() @IsString() dateEcheance?: string;
  /** Applique les nouveaux prix de vente proposes par la reception. */
  @IsOptional() @IsBoolean() appliquerPrixVente?: boolean;
}

export class ReglerFactureDto {
  @IsString() compteId: string;
  @IsInt() @Min(1) montantCentimes: number;
}
