import { IsString, IsOptional, IsEnum, IsInt, IsBoolean, Min, MinLength } from 'class-validator';
import { TypeTiers, TypeClient, CategoriePrix } from '@prisma/client';

export class CreerTiersDto {
  @IsString() @MinLength(1) code: string;
  @IsEnum(TypeTiers) type: TypeTiers;
  @IsString() @MinLength(2) raisonSociale: string;
  @IsOptional() @IsEnum(TypeClient) typeClient?: TypeClient;
  @IsOptional() @IsString() adresse?: string;
  @IsOptional() @IsString() telephone?: string;
  @IsOptional() @IsString() telephone2?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() rc?: string;
  @IsOptional() @IsString() nif?: string;
  @IsOptional() @IsString() nis?: string;
  @IsOptional() @IsString() articleImposition?: string;
  @IsOptional() @IsString() banque?: string;
  @IsOptional() @IsString() rib?: string;
  @IsOptional() @IsEnum(CategoriePrix) categoriePrix?: CategoriePrix;
  @IsOptional() @IsInt() @Min(0) remisePourcent?: number;
  @IsOptional() @IsInt() @Min(0) plafondCreditCentimes?: number;
  @IsOptional() @IsString() carteFidelite?: string;
  @IsOptional() @IsString() magasinInterneId?: string;
}

export class ModifierTiersDto {
  @IsOptional() @IsString() raisonSociale?: string;
  @IsOptional() @IsString() adresse?: string;
  @IsOptional() @IsString() telephone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() rc?: string;
  @IsOptional() @IsString() nif?: string;
  @IsOptional() @IsString() nis?: string;
  @IsOptional() @IsEnum(CategoriePrix) categoriePrix?: CategoriePrix;
  @IsOptional() @IsInt() @Min(0) remisePourcent?: number;
  @IsOptional() @IsInt() @Min(0) plafondCreditCentimes?: number;
  @IsOptional() @IsString() carteFidelite?: string;
  @IsOptional() @IsBoolean() actif?: boolean;
}

export class BlocageDto {
  @IsString() @MinLength(3) motif: string;
}

export class FusionDto {
  @IsString() absorbeId: string;
}

export class ReglementClientDto {
  @IsString() compteId: string;
  @IsInt() @Min(1) montantCentimes: number;
  @IsOptional() @IsString() reference?: string;
}
