import { IsString, IsInt, IsOptional, IsArray, ValidateNested, IsEnum, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { TypeMouvementCaisse } from '@prisma/client';

export class OuvrirSessionDto {
  @IsString() caisseId: string;
  @IsInt() @Min(0) fondDeCaisseCentimes: number;
  @IsOptional() @IsString() numeroPropose?: string;
}

export class LigneComptageDto {
  @IsInt() @Min(1) coupureCentimes: number;
  @IsInt() @Min(0) nombre: number;
}

export class ClotureDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => LigneComptageDto)
  comptage: LigneComptageDto[];

  @IsOptional() @IsString() justification?: string;
  @IsOptional() @IsString() numeroPropose?: string;
}

export class MouvementCaisseDto {
  @IsEnum(TypeMouvementCaisse) type: TypeMouvementCaisse;
  @IsInt() @Min(1) montantCentimes: number;
  @IsString() @MinLength(3) motif: string;
}

export class AnnulationDto {
  @IsString() @MinLength(3) motif: string;
}
