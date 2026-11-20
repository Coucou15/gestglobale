import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { CLE_DROITS, CLE_PUBLIC, type UtilisateurConnecte } from './droits.decorator';

/**
 * Garde unique : authentifie la requete puis verifie les droits exiges
 * par le decorateur @Droits. Une route sans @Droits reste protegee par
 * l'authentification ; seule @Public l'ouvre.
 */
@Injectable()
export class DroitsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(contexte: ExecutionContext): Promise<boolean> {
    const publique = this.reflector.getAllAndOverride<boolean>(CLE_PUBLIC, [
      contexte.getHandler(),
      contexte.getClass(),
    ]);
    if (publique) return true;

    const requete = contexte.switchToHttp().getRequest();
    const entete: string | undefined = requete.headers?.authorization;
    if (!entete?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentification requise');
    }

    let charge: Record<string, unknown>;
    try {
      charge = await this.jwt.verifyAsync(entete.slice(7), {
        secret: this.config.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Jeton invalide ou expire');
    }

    const utilisateur: UtilisateurConnecte = {
      id: charge.sub as string,
      code: charge.code as string,
      nom: charge.nom as string,
      login: charge.login as string,
      role: charge.role as string,
      permissions: (charge.permissions as string[]) ?? [],
      magasins: (charge.magasins as string[]) ?? [],
      poste: (charge.poste as string) ?? null,
      depuisInternet: Boolean(charge.depuisInternet),
    };
    requete.utilisateur = utilisateur;

    const requises = this.reflector.getAllAndOverride<string[]>(CLE_DROITS, [
      contexte.getHandler(),
      contexte.getClass(),
    ]);
    if (!requises || requises.length === 0) return true;

    const manquantes = requises.filter((d) => !utilisateur.permissions.includes(d));
    if (manquantes.length > 0) {
      throw new ForbiddenException(
        `Droit insuffisant : ${manquantes.join(', ')}`,
      );
    }
    return true;
  }
}
