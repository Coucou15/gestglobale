import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SyncService } from './sync.service';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';
import { DemandeDescenteDto, DemandeRemonteeDto } from './dto';

@ApiTags('Synchronisation caisse')
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /** Descente : catalogue, prix, clients, promotions et droits modifies. */
  @Post('descente')
  @Droits(PERMISSIONS.VENTE_ENCAISSER)
  descente(@Body() dto: DemandeDescenteDto) {
    return this.sync.descente(dto);
  }

  /** Remontee : tickets, clotures et mouvements, avec accuse par element. */
  @Post('remontee')
  @Droits(PERMISSIONS.VENTE_ENCAISSER)
  remontee(@Body() dto: DemandeRemonteeDto) {
    return this.sync.remontee(dto);
  }

  @Get('etat')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  etat(@Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.sync.etatCaisses(utilisateur.magasins);
  }

  /** Tickets passes a un prix qui n'etait plus celui du serveur. */
  @Get('prix-perimes')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  prixPerimes(@Utilisateur() utilisateur: UtilisateurConnecte, @Query('jours') jours?: string) {
    return this.sync.ticketsPrixPerime(utilisateur.magasins, jours ? Number(jours) : 7);
  }
}
