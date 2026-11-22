import { BadRequestException, Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { ComptabiliteService } from './comptabilite.service';
import * as presentation from './presentation';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';
import { nomDeFichier, type Rapport } from '../rapports/tableau';
import { enCsv, enExcel, enPdf, type OptionsCsv } from '../rapports/exports';

/**
 * Journaux comptables et etats de declaration (M12).
 *
 * Reserves au comptable et au gerant : ces journaux donnent les
 * chiffres de tous les magasins, les marges comprises.
 */
@ApiTags('M12 — Comptabilite et exports')
@Controller('comptabilite')
export class ComptabiliteController {
  constructor(private readonly comptabilite: ComptabiliteService) {}

  private periode(debut?: string, fin?: string): { debut: Date; fin: Date } {
    // Par defaut : le mois precedent. Un comptable travaille sur un
    // mois clos, pas sur le mois en cours.
    const maintenant = new Date();
    const d = debut
      ? new Date(debut)
      : new Date(maintenant.getFullYear(), maintenant.getMonth() - 1, 1);
    const f = fin
      ? new Date(fin)
      : new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
    if (Number.isNaN(d.getTime()) || Number.isNaN(f.getTime())) {
      throw new BadRequestException('Dates de periode illisibles');
    }
    if (d >= f) {
      throw new BadRequestException('La date de debut doit preceder la date de fin');
    }
    return { debut: d, fin: f };
  }

  @Get('journal-ventes')
  @Droits(PERMISSIONS.RAPPORT_TOUS)
  ventes(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
  ) {
    return this.comptabilite.journalVentes({
      magasinIds: utilisateur.magasins, ...this.periode(debut, fin),
    });
  }

  @Get('journal-achats')
  @Droits(PERMISSIONS.RAPPORT_TOUS)
  achats(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
  ) {
    return this.comptabilite.journalAchats({
      magasinIds: utilisateur.magasins, ...this.periode(debut, fin),
    });
  }

  @Get('journal-tresorerie')
  @Droits(PERMISSIONS.RAPPORT_TOUS)
  tresorerie(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
    @Query('compteId') compteId?: string,
  ) {
    return this.comptabilite.journalTresorerie({
      magasinIds: utilisateur.magasins, ...this.periode(debut, fin), compteId,
    });
  }

  @Get('declaration')
  @Droits(PERMISSIONS.RAPPORT_TOUS)
  declaration(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
  ) {
    return this.comptabilite.etatDeclaration({
      magasinIds: utilisateur.magasins, ...this.periode(debut, fin),
    });
  }

  /**
   * Export d'un journal en CSV, Excel ou PDF.
   *
   * Le CSV existe pour le logiciel du comptable ; ses reglages
   * — separateur, decimale, marque d'encodage — sont des parametres de
   * la requete, parce que le format exact qu'il attend n'est pas connu
   * et qu'il differe d'un cabinet a l'autre.
   */
  @Get(':nom/export.:format')
  @Droits(PERMISSIONS.RAPPORT_TOUS)
  async exporter(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Param('nom') nom: string,
    @Param('format') format: string,
    @Res({ passthrough: true }) reponse: Response,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
    @Query('separateur') separateur?: string,
    @Query('decimale') decimale?: string,
    @Query('bom') bom?: string,
  ): Promise<StreamableFile> {
    if (format !== 'csv' && format !== 'xlsx' && format !== 'pdf') {
      throw new BadRequestException(
        `Format « ${format} » inconnu : seuls csv, xlsx et pdf sont produits`,
      );
    }

    const rapport = await this.composer(utilisateur, nom, debut, fin);

    let contenu: Buffer;
    let type: string;
    if (format === 'csv') {
      contenu = enCsv(rapport, this.optionsCsv(separateur, decimale, bom));
      type = 'text/csv; charset=utf-8';
    } else if (format === 'xlsx') {
      contenu = await enExcel(rapport);
      type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      contenu = await enPdf(rapport);
      type = 'application/pdf';
    }

    reponse.set({
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${nomDeFichier(rapport.titre, format)}"`,
      'Content-Length': String(contenu.length),
    });
    return new StreamableFile(contenu);
  }

  private optionsCsv(separateur?: string, decimale?: string, bom?: string): OptionsCsv {
    const separateurs: Record<string, OptionsCsv['separateur']> = {
      ';': ';', ',': ',', 'point-virgule': ';', virgule: ',', tabulation: '\t',
    };
    if (separateur && !(separateur in separateurs)) {
      throw new BadRequestException(
        'Separateur inconnu : point-virgule (defaut), virgule ou tabulation',
      );
    }
    if (decimale && decimale !== ',' && decimale !== '.') {
      throw new BadRequestException('Decimale : « , » (defaut) ou « . »');
    }
    return {
      ...(separateur ? { separateur: separateurs[separateur] } : {}),
      ...(decimale ? { decimale: decimale as ',' | '.' } : {}),
      ...(bom !== undefined ? { bom: bom !== 'false' } : {}),
    };
  }

  private async composer(
    utilisateur: UtilisateurConnecte,
    nom: string,
    debut?: string,
    fin?: string,
  ): Promise<Rapport> {
    const magasinIds = utilisateur.magasins;
    const periode = this.periode(debut, fin);

    switch (nom) {
      case 'journal-ventes':
        return presentation.journalVentes(
          await this.comptabilite.journalVentes({ magasinIds, ...periode }),
        );
      case 'journal-achats':
        return presentation.journalAchats(
          await this.comptabilite.journalAchats({ magasinIds, ...periode }),
        );
      case 'journal-tresorerie':
        return presentation.journalTresorerie(
          await this.comptabilite.journalTresorerie({ magasinIds, ...periode }),
        );
      case 'declaration':
        return presentation.etatDeclaration(
          await this.comptabilite.etatDeclaration({ magasinIds, ...periode }),
        );
      default:
        throw new BadRequestException(
          `Journal « ${nom} » inconnu. Disponibles : journal-ventes, journal-achats, `
          + 'journal-tresorerie, declaration',
        );
    }
  }
}
