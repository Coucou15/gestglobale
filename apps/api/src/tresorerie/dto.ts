import { IsString, IsInt, IsOptional, IsEnum, IsArray, IsBoolean, Min, MinLength } from 'class-validator';
import { CategorieOperation, SensOperation, TypeCompte } from '@prisma/client';

export class CreerCompteDto {
  @IsString() code: string;
  @IsString() libelle: string;
  @IsEnum(TypeCompte) type: TypeCompte;
  @IsOptional() @IsString() magasinId?: string;
  @IsOptional() @IsString() caisseId?: string;
  @IsOptional() @IsString() numeroCompte?: string;
  @IsOptional() @IsString() banque?: string;
}

export class OperationDto {
  @IsString() compteId: string;
  @IsEnum(SensOperation) sens: SensOperation;
  @IsEnum(CategorieOperation) categorie: CategorieOperation;
  @IsInt() @Min(1) montantCentimes: number;
  @IsString() @MinLength(2) libelle: string;
  @IsOptional() @IsString() tiersId?: string;
  @IsOptional() @IsString() employeId?: string;
  @IsOptional() @IsString() date?: string;
}

export class TransfertDto {
  @IsString() compteSourceId: string;
  @IsString() compteDestinationId: string;
  @IsInt() @Min(1) montantCentimes: number;
  @IsOptional() @IsString() motif?: string;
}

export class RefusDto {
  @IsString() @MinLength(3) commentaire: string;
}

export class PointageDto {
  @IsArray() @IsString({ each: true }) operationIds: string[];
  @IsBoolean() pointee: boolean;
}
