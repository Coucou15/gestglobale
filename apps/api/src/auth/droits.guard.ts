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
import { PrismaService } from '../prisma/prisma.service';

/**
 * Garde unique : authentifie la requete puis verifie les droits exiges
 * par le decorateur @Droits. Une route sans @Droits reste protegee par
 * l'authentification ; seule @Public l'ouvre.
 *
 * Le compte est verifie actif a chaque requete, et pas seulement a la
 * connexion. Sans cela, un employe qui part garde la main jusqu'a
 * l'expiration de son jeton : son code PIN ne marche plus, mais la
 * session deja ouverte, si. Pour une caisse, ce quart d'heure est
 * exactement la faille que le cahier des charges veut fermer.
 *
 * Le cout est une lecture par cle primaire, servie par le cache de
 * PostgreSQL : quelques dixiemes de milliseconde, a comparer aux
 * dizaines que coute la requete metier qui suit.
 */
@Injectable()
export class DroitsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
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
    const compte = await this.prisma.utilisateur.findUnique({
      where: { id: utilisateur.id },
      select: { actif: true, bloqueJusqua: true },
    });
    if (!compte || !compte.actif) {
      throw new UnauthorizedException(
        'Ce compte n\u2019est plus actif : rapprochez-vous de votre responsable',
      );
    }
    if (compte.bloqueJusqua && compte.bloqueJusqua > new Date()) {
      throw new UnauthorizedException('Ce compte est temporairement bloque');
    }

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
