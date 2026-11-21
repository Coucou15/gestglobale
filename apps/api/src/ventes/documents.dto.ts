import {
  IsString, IsInt, IsOptional, IsEnum, IsArray, ValidateNested, Min, Max, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ModePaiement, TypeDocumentVente } from '@prisma/client';

export class LigneDocumentDto {
  @IsString() articleId: string;
  @IsInt() @Min(1) quantiteMilli: number;
  @IsOptional() @IsInt() @Min(0) prixUnitaireCentimes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) remisePourcent?: number;
}

export class CreerDocumentDto {
  @IsEnum(TypeDocumentVente) type: TypeDocumentVente;
  @IsString() magasinId: string;
  @IsOptional() @IsString() clientId?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => LigneDocumentDto)
  lignes: LigneDocumentDto[];
  @IsOptional() @IsInt() @Min(0) @Max(100) remisePiedPourcent?: number;
  @IsOptional() @IsEnum(ModePaiement) modePaiement?: ModePaiement;
  @IsOptional() @IsString() dateEcheance?: string;
  @IsOptional() @IsString() @MaxLength(500) observation?: string;
}

export class ValiderDocumentDto {
  @IsOptional() @IsEnum(ModePaiement) modePaiement?: ModePaiement;
  @IsOptional() @IsString() compteId?: string;
}

export class TransformerDto {
  @IsEnum(TypeDocumentVente) vers: TypeDocumentVente;
}
