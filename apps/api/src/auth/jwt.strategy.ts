import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { UtilisateurConnecte } from './droits.decorator';

interface ChargeJeton {
  sub: string;
  code: string;
  nom: string;
  login: string;
  role: string;
  permissions: string[];
  magasins: string[];
  poste: string | null;
  depuisInternet: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'secret-absent',
    });
  }

  validate(charge: ChargeJeton): UtilisateurConnecte {
    return {
      id: charge.sub,
      code: charge.code,
      nom: charge.nom,
      login: charge.login,
      role: charge.role,
      permissions: charge.permissions ?? [],
      magasins: charge.magasins ?? [],
      poste: charge.poste,
      depuisInternet: charge.depuisInternet,
    };
  }
}
