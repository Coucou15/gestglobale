import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';

/**
 * Referentiel de saisie.
 *
 * Tout ce dont les ecrans ont besoin pour remplir leurs listes
 * deroulantes. Aucun droit particulier n'est exige au-dela de
 * l'authentification : ce sont des libelles, et le contenu est de toute
 * facon limite aux magasins de l'utilisateur.
 */
@ApiTags('Referentiel')
@Controller('referentiel')
export class ReferentielController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('magasins')
  magasins(@Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.prisma.magasin.findMany({
      where: { id: { in: utilisateur.magasins }, actif: true },
      orderBy: { nom: 'asc' },
      select: {
        id: true,
        code: true,
        nom: true,
        emplacements: {
          where: { actif: true },
          orderBy: { code: 'asc' },
          select: {
            id: true, code: true, nom: true, type: true,
            parDefautReception: true, parDefautVente: true,
          },
        },
        caisses: {
          where: { actif: true },
          orderBy: { numero: 'asc' },
          select: { id: true, numero: true, libelle: true },
        },
      },
    });
  }

  @Get('rayons')
  rayons() {
    return this.prisma.rayon.findMany({
      where: { actif: true },
      orderBy: [{ ordre: 'asc' }, { nom: 'asc' }],
      select: { id: true, code: true, nom: true },
    });
  }

  @Get('familles')
  familles() {
    return this.prisma.famille.findMany({
      where: { actif: true },
      orderBy: { nom: 'asc' },
      select: { id: true, code: true, nom: true, rayonId: true, suiviPeremption: true },
    });
  }
}
