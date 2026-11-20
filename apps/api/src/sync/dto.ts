import { IsArray, IsInt, IsOptional, IsString, Min, IsObject } from 'class-validator';

/**
 * Les charges de synchronisation sont volumineuses et deja typees par le
 * paquet partage ; la validation porte ici sur l'enveloppe, le contenu
 * etant verifie element par element a l'ecriture (et refuse individuellement).
 */
export class DemandeDescenteDto {
  @IsInt() versionProtocole: number;
  @IsString() codeMagasin: string;
  @IsInt() @Min(1) numeroCaisse: number;
  @IsOptional() @IsString() curseur: string | null;
  @IsOptional() @IsInt() @Min(1) limite?: number;
}

export class DemandeRemonteeDto {
  @IsInt() versionProtocole: number;
  @IsString() codeMagasin: string;
  @IsInt() @Min(1) numeroCaisse: number;
  @IsArray() @IsObject({ each: true }) tickets: never[];
  @IsArray() @IsObject({ each: true }) clotures: never[];
  @IsArray() @IsObject({ each: true }) mouvements: never[];
}
