import { IsString, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';

export class ConnexionWebDto {
  @IsString()
  @MinLength(2)
  login: string;

  @IsString()
  @MinLength(8, { message: 'Le mot de passe fait au moins 8 caracteres' })
  motDePasse: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Le code de double authentification fait 6 chiffres' })
  codeTotp?: string;
}

export class ConnexionPinDto {
  @IsString()
  code: string;

  @IsString()
  @MinLength(4, { message: 'Le PIN fait au moins 4 chiffres' })
  @MaxLength(12)
  pin: string;

  @IsOptional()
  @IsString()
  poste?: string;
}

export class RafraichirDto {
  @IsString()
  rafraichissement: string;
}

export class SuperviseurDto {
  @IsString()
  code: string;

  @IsString()
  pin: string;

  @IsString()
  permission: string;
}

export class CodeTotpDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}
