import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RapportsService } from './rapports.service';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';

@ApiTags('M9 — Rapports')
@Controller('rapports')
export class RapportsController {
  constructor(private readonly rapports: RapportsService) {}

  private periode(debut?: string, fin?: string): { debut: Date; fin: Date } {
    // Par defaut : le mois en cours.
    const maintenant = new Date();
    const d = debut
      ? new Date(debut)
      : new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
    const f = fin
      ? new Date(fin)
      : new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 1);
    return { debut: d, fin: f };
  }

  @Get('periode')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  synthese(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
  ) {
    return this.rapports.periode({ magasinIds: utilisateur.magasins, ...this.periode(debut, fin) });
  }

  @Get('produits')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  produits(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('sens') sens?: 'TOP' | 'FLOP',
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
    @Query('limite') limite?: string,
  ) {
    return this.rapports.produits({
      magasinIds: utilisateur.magasins,
      ...this.periode(debut, fin),
      sens: sens === 'FLOP' ? 'FLOP' : 'TOP',
      limite: limite ? Number(limite) : 20,
    });
  }

  @Get('dormants')
  @Droits(PERMISSIONS.RAPPORT_STOCKS)
  dormants(@Utilisateur() utilisateur: UtilisateurConnecte, @Query('jours') jours?: string) {
    return this.rapports.dormants({
      magasinIds: utilisateur.magasins,
      jours: jours ? Number(jours) : 90,
    });
  }
}
