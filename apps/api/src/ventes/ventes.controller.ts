import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VentesService } from './ventes.service';
import { PrismaService } from '../prisma/prisma.service';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';

@ApiTags('M5 — Ventes')
@Controller('ventes')
export class VentesController {
  constructor(
    private readonly ventes: VentesService,
    private readonly prisma: PrismaService,
  ) {}

  /** Ce que le gerant consulte depuis son smartphone hors du magasin. */
  @Get('jour')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  jour(@Utilisateur() utilisateur: UtilisateurConnecte, @Query('date') date?: string) {
    return this.ventes.ventesDuJour(utilisateur.magasins, date ? new Date(date) : new Date());
  }

  @Get()
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  lister(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('depuis') depuis?: string,
    @Query('jusqua') jusqua?: string,
    @Query('caisseId') caisseId?: string,
    @Query('clientId') clientId?: string,
    @Query('taille') taille?: string,
  ) {
    return this.prisma.documentVente.findMany({
      where: {
        magasinId: { in: utilisateur.magasins },
        ...(caisseId ? { caisseId } : {}),
        ...(clientId ? { clientId } : {}),
        ...(depuis || jusqua
          ? {
              dateVente: {
                ...(depuis ? { gte: new Date(depuis) } : {}),
                ...(jusqua ? { lte: new Date(jusqua) } : {}),
              },
            }
          : {}),
      },
      orderBy: { dateVente: 'desc' },
      take: Math.min(Number(taille) || 100, 500),
      include: {
        client: { select: { code: true, raisonSociale: true } },
        utilisateur: { select: { code: true, nom: true } },
        caisse: { select: { numero: true } },
        reglements: true,
        _count: { select: { lignes: true } },
      },
    });
  }

  @Get(':numero')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  parNumero(@Param('numero') numero: string) {
    return this.prisma.documentVente.findUniqueOrThrow({
      where: { numero },
      include: {
        lignes: { orderBy: { numeroLigne: 'asc' } },
        reglements: true,
        client: true,
        utilisateur: { select: { code: true, nom: true } },
        caisse: { select: { numero: true, libelle: true } },
      },
    });
  }
}
