import {
  BadRequestException, Body, Controller, Get, Param, Post, Query,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { GraviteAnomalie, OrigineHistorique, TypeImport } from '@prisma/client';
import { ImportService } from './import.service';
import { FormatNonGere } from './lecture';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

class ExecuterImportDto {
  @IsString() magasinId: string;
  @IsString() emplacementDepotId: string;
  @IsString() emplacementVenteId: string;
  @IsOptional() @IsBoolean() forcer?: boolean;
}

/** Taille maximale du classeur accepte (28 272 produits tiennent largement). */
const TAILLE_MAX = 64 * 1024 * 1024;

@ApiTags('Migration — assistant d’import')
@Controller('import')
export class ImportController {
  constructor(private readonly importation: ImportService) {}

  /**
   * Import a blanc : lit le classeur, controle tout, n'ecrit rien.
   * C'est l'etape 1 du deroule de la section 7.
   */
  @Post('analyse')
  @Droits(PERMISSIONS.IMPORT_EXECUTER)
  @UseInterceptors(FileInterceptor('fichier', { limits: { fileSize: TAILLE_MAX } }))
  async analyser(
    @UploadedFile() fichier: Express.Multer.File,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    if (!fichier) throw new BadRequestException('Aucun fichier recu');

    const { resultat } = await this.traduireFormat(() =>
      this.importation.analyser(fichier.buffer),
    );
    const session = await this.importation.enregistrerSession({
      nomFichier: fichier.originalname,
      type: TypeImport.BLANC,
      resultat,
      utilisateurId: utilisateur.id,
    });

    const erreurs = resultat.anomalies.filter((a) => a.gravite === GraviteAnomalie.ERREUR).length;
    const avertissements = resultat.anomalies.filter(
      (a) => a.gravite === GraviteAnomalie.AVERTISSEMENT,
    ).length;

    return {
      sessionId: session.id,
      pretPourLaBascule: erreurs === 0,
      erreurs,
      avertissements,
      onglets: resultat.onglets,
      controles: resultat.controles,
      // Les 200 premieres suffisent a l'ecran ; le reste s'obtient par
      // /import/sessions/:id/anomalies.
      apercuAnomalies: resultat.anomalies.slice(0, 200),
    };
  }

  /**
   * Import definitif. A lancer le soir de la bascule, apres la derniere
   * cloture de caisse de l'ancien logiciel.
   */
  @Post('executer')
  @Droits(PERMISSIONS.IMPORT_EXECUTER)
  @UseInterceptors(FileInterceptor('fichier', { limits: { fileSize: TAILLE_MAX } }))
  async executer(
    @UploadedFile() fichier: Express.Multer.File,
    @Body() dto: ExecuterImportDto,
    @Utilisateur() utilisateur: UtilisateurConnecte,
  ) {
    if (!fichier) throw new BadRequestException('Aucun fichier recu');
    // Le classeur n'est lu qu'une fois : traduire un format non gere ne
    // justifie pas de l'analyser deux fois, sur 28 000 lignes.
    return this.traduireFormat(() =>
      this.importation.executer({
        tampon: fichier.buffer,
        nomFichier: fichier.originalname,
        magasinId: dto.magasinId,
        emplacementDepotId: dto.emplacementDepotId,
        emplacementVenteId: dto.emplacementVenteId,
        utilisateurId: utilisateur.id,
        forcer: dto.forcer === true || String(dto.forcer) === 'true',
      }),
    );
  }

  /**
   * Traduit un format de fichier non gere en consigne directement lisible
   * par le gerant, plutot qu'en erreur technique.
   */
  private async traduireFormat<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (erreur) {
      if (erreur instanceof FormatNonGere) {
        throw new BadRequestException(erreur.message);
      }
      throw erreur;
    }
  }

  @Get('sessions')
  @Droits(PERMISSIONS.IMPORT_EXECUTER)
  sessions() {
    return this.importation.sessions();
  }

  @Get('sessions/:id/anomalies')
  @Droits(PERMISSIONS.IMPORT_EXECUTER)
  anomalies(@Param('id') id: string, @Query('gravite') gravite?: GraviteAnomalie) {
    return this.importation.anomalies(id, gravite);
  }

  /**
   * Historique repris de l'ancien logiciel, en lecture seule (section 7).
   * Accessible a qui peut consulter les rapports, pas seulement a
   * l'operateur de la migration.
   */
  @Get('historique')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  historique(
    @Query('origine') origine?: OrigineHistorique,
    @Query('texte') texte?: string,
    @Query('depuis') depuis?: string,
    @Query('jusqua') jusqua?: string,
    @Query('page') page?: string,
    @Query('taille') taille?: string,
  ) {
    return this.importation.historique({
      origine,
      texte,
      depuis: depuis ? new Date(depuis) : undefined,
      jusqua: jusqua ? new Date(jusqua) : undefined,
      page: page ? Number(page) : 1,
      taille: taille ? Number(taille) : 50,
    });
  }

  /** Controles de bascule a comparer avec l'ancien logiciel. */
  @Get('controles')
  @Droits(PERMISSIONS.IMPORT_EXECUTER)
  controles() {
    return this.importation.controlesDeBascule();
  }
}
