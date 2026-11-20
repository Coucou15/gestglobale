import {
  IsString, IsOptional, IsInt, IsBoolean, IsEnum, IsArray, IsObject,
  Min, Max, MinLength, IsNumber, ArrayMaxSize,
} from 'class-validator';
import { TypeArticle, CategoriePrix } from '@prisma/client';

export class CreerArticleDto {
  @IsString() @MinLength(1)
  reference: string;

  @IsString() @MinLength(2)
  designation: string;

  @IsOptional() @IsString()
  designationAr?: string;

  @IsOptional() @IsEnum(TypeArticle)
  type?: TypeArticle;

  @IsOptional() @IsString()
  unite?: string;

  @IsOptional() @IsInt() @Min(0) @Max(3)
  decimales?: number;

  @IsOptional() @IsString() rayonId?: string;
  @IsOptional() @IsString() familleId?: string;
  @IsOptional() @IsString() gammeId?: string;
  @IsOptional() @IsString() marqueId?: string;

  @IsOptional() @IsInt() @Min(0) @Max(100)
  tauxTva?: number;

  @IsOptional() @IsBoolean() estVrac?: boolean;
  @IsOptional() @IsString() packDeId?: string;
  @IsOptional() @IsInt() @Min(1) packNbUnites?: number;
  @IsOptional() @IsBoolean() gestionLot?: boolean;
  @IsOptional() @IsInt() @Min(0) joursAlertePeremption?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  codesBarres?: string[];

  /** { DETAIL: 12500, GROS: 11000 } en centimes. */
  @IsOptional() @IsObject()
  prix?: Record<string, number>;
}

export class ModifierArticleDto {
  @IsOptional() @IsString() @MinLength(2) designation?: string;
  @IsOptional() @IsString() designationAr?: string;
  @IsOptional() @IsString() unite?: string;
  @IsOptional() @IsInt() @Min(0) @Max(3) decimales?: number;
  @IsOptional() @IsString() rayonId?: string;
  @IsOptional() @IsString() familleId?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) tauxTva?: number;
  @IsOptional() @IsBoolean() venteAutorisee?: boolean;
  @IsOptional() @IsBoolean() archive?: boolean;
  @IsOptional() @IsBoolean() gestionLot?: boolean;
}

export class CodeBarreDto {
  @IsString() @MinLength(4)
  code: string;
}

export class ChangerPrixDto {
  @IsEnum(CategoriePrix) categorie: CategoriePrix;
  @IsInt() @Min(0) prixCentimes: number;
  @IsOptional() @IsString() magasinId?: string;
  @IsOptional() @IsString() motif?: string;
}

export type ModeModificationMasse = 'POURCENTAGE' | 'MONTANT' | 'MARGE_CIBLE';

export class ModificationMasseDto {
  @IsEnum(['POURCENTAGE', 'MONTANT', 'MARGE_CIBLE'])
  mode: ModeModificationMasse;

  /** Pourcentage (ex. 5 ou -3), montant en centimes, ou taux de marge cible. */
  @IsNumber()
  valeur: number;

  @IsEnum(CategoriePrix)
  categorie: CategoriePrix;

  @IsOptional() @IsString() familleId?: string;
  @IsOptional() @IsString() rayonId?: string;
  @IsOptional() @IsString() fournisseurId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) articleIds?: string[];
  @IsOptional() @IsString() magasinId?: string;

  /** Arrondir le prix obtenu au multiple de N centimes (ex. 500 = 5 DA). */
  @IsOptional() @IsInt() @Min(0) arrondiCentimes?: number;

  @IsOptional() @IsString() motif?: string;

  /** Faux = simulation seule, aucun prix n'est change. */
  @IsOptional() @IsBoolean() appliquer?: boolean;

  /** Confirme explicitement les prix passant sous le cout d'achat. */
  @IsOptional() @IsBoolean() accepterVenteAPerte?: boolean;
}
