import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CaisseService } from './caisse.service';
import { VentesService } from '../ventes/ventes.service';
import { PrismaService } from '../prisma/prisma.service';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';
import { OuvrirSessionDto, ClotureDto, MouvementCaisseDto, AnnulationDto } from './dto';

@ApiTags('M4 — Caisse')
@Controller('caisse')
export class CaisseController {
  constructor(
    private readonly caisse: CaisseService,
    private readonly ventes: VentesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('caisses')
  @Droits(PERMISSIONS.VENTE_ENCAISSER)
  caisses(@Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.prisma.caisse.findMany({
      where: { magasinId: { in: utilisateur.magasins }, actif: true },
      orderBy: { numero: 'asc' },
      include: {
        magasin: { select: { code: true, nom: true } },
        sessions: { where: { statut: 'OUVERTE' }, select: { id: true, numero: true, ouverteLe: true } },
      },
    });
  }

  @Post('sessions')
  @Droits(PERMISSIONS.CAISSE_OUVRIR)
  ouvrir(@Body() dto: OuvrirSessionDto, @Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.caisse.ouvrirSession({ ...dto, utilisateurId: utilisateur.id });
  }

  @Get('sessions/:id/totaux')
  @Droits(PERMISSIONS.CAISSE_OUVRIR)
  totaux(@Param('id') id: string) {
    return this.caisse.totauxSession(id);
  }

  /** Previsualisation : le caissier voit l'ecart avant de valider. */
  @Post('sessions/:id/cloture/previsualiser')
  @Droits(PERMISSIONS.CAISSE_CLOTURER)
  previsualiser(@Param('id') id: string, @Body() dto: ClotureDto) {
    return this.caisse.previsualiserCloture(id, dto.comptage);
  }

  @Post('sessions/:id/cloture')
  @Droits(PERMISSIONS.CAISSE_CLOTURER)
  cloturer(
    @Param('id') id: string,
    @Body() dto: ClotureDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.caisse.cloturer({
      sessionId: id,
      comptage: dto.comptage,
      justification: dto.justification,
      numeroPropose: dto.numeroPropose,
      utilisateurId: utilisateur.id,
    });
  }

  @Post('sessions/:id/mouvements')
  @Droits(PERMISSIONS.CAISSE_PRELEVER)
  mouvement(
    @Param('id') id: string,
    @Body() dto: MouvementCaisseDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.caisse.mouvementCaisse({ sessionId: id, ...dto, utilisateurId: utilisateur.id });
  }

  /** Ecarts de caisse par caissier sur 30 jours (M9). */
  @Get('ecarts')
  @Droits(PERMISSIONS.CAISSE_VALIDER_ECART)
  ecarts(@Utilisateur() utilisateur: UtilisateurConnecte, @Query('jours') jours?: string) {
    return this.caisse.ecartsParCaissier(utilisateur.magasins, jours ? Number(jours) : 30);
  }

  @Post('tickets/:numero/annulation')
  @Droits(PERMISSIONS.VENTE_ANNULER_TICKET)
  annuler(
    @Param('numero') numero: string,
    @Body() dto: AnnulationDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    return this.ventes.annulerTicket(numero, dto.motif, utilisateur.id);
  }
}
