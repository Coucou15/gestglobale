import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { Public, Utilisateur, type UtilisateurConnecte } from './droits.decorator';
import {
  ConnexionWebDto,
  ConnexionPinDto,
  RafraichirDto,
  SuperviseurDto,
  CodeTotpDto,
} from './dto';
import { normaliser } from './reseau.util';

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private contexte(requete: Request, poste?: string) {
    return {
      adresseIp: normaliser(requete.ip ?? requete.socket?.remoteAddress ?? ''),
      agent: requete.headers['user-agent'],
      poste: poste ?? (requete.headers['x-poste'] as string | undefined),
    };
  }

  @Public()
  @Post('connexion')
  connexionWeb(@Body() dto: ConnexionWebDto, @Req() requete: Request) {
    return this.auth.connexionWeb(dto.login, dto.motDePasse, dto.codeTotp, this.contexte(requete));
  }

  /** Connexion caisse par code et PIN (section 6). */
  @Public()
  @Post('connexion-pin')
  connexionPin(@Body() dto: ConnexionPinDto, @Req() requete: Request) {
    return this.auth.connexionPin(dto.code, dto.pin, this.contexte(requete, dto.poste));
  }

  @Public()
  @Post('rafraichir')
  rafraichir(@Body() dto: RafraichirDto, @Req() requete: Request) {
    return this.auth.rafraichir(dto.rafraichissement, this.contexte(requete));
  }

  @Post('deconnexion')
  async deconnexion(
    @Body() dto: RafraichirDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    await this.auth.deconnexion(dto.rafraichissement, utilisateur.id);
    return { deconnecte: true };
  }

  @Get('moi')
  moi(@Utilisateur() utilisateur: UtilisateurConnecte) {
    return utilisateur;
  }

  /** Validation d'un code superviseur pour un forcage en caisse. */
  @Post('superviseur')
  superviseur(@Body() dto: SuperviseurDto) {
    return this.auth.verifierSuperviseur(dto.code, dto.pin, dto.permission);
  }

  @Post('double-authentification/preparer')
  preparer2fa(@Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.auth.preparerDoubleAuth(utilisateur.id);
  }

  @Post('double-authentification/activer')
  activer2fa(@Body() dto: CodeTotpDto, @Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.auth.activerDoubleAuth(utilisateur.id, dto.code);
  }
}
