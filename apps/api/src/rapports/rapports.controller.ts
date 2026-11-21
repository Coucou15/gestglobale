import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { RapportsService } from './rapports.service';
import { ResumeService } from './resume.service';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';
import { nomDeFichier, type Rapport } from './tableau';
import { enExcel, enPdf } from './exports';
import * as presentation from './presentation';

/** Formats d'export offerts par chaque rapport (M9). */
type Format = 'xlsx' | 'pdf';

@ApiTags('M9 — Rapports')
@Controller('rapports')
export class RapportsController {
  constructor(
    private readonly rapports: RapportsService,
    private readonly resume: ResumeService,
  ) {}

  private periode(debut?: string, fin?: string): { debut: Date; fin: Date } {
    // Par defaut : le mois en cours.
    const maintenant = new Date();
    const d = debut
      ? new Date(debut)
      : new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
    const f = fin
      ? new Date(fin)
      : new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 1);
    if (Number.isNaN(d.getTime()) || Number.isNaN(f.getTime())) {
      throw new BadRequestException('Dates de periode illisibles');
    }
    if (d >= f) {
      throw new BadRequestException('La date de debut doit preceder la date de fin');
    }
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

  /** Ruptures et articles sous leur seuil de reassort (M9). */
  @Get('ruptures')
  @Droits(PERMISSIONS.RAPPORT_STOCKS)
  ruptures(@Utilisateur() utilisateur: UtilisateurConnecte, @Query('limite') limite?: string) {
    return this.rapports.ruptures({
      magasinIds: utilisateur.magasins,
      limite: limite ? Number(limite) : undefined,
    });
  }

  /** Produits vendus sous leur CUMP (M9). */
  @Get('ventes-a-perte')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  ventesAPerte(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
  ) {
    return this.rapports.ventesAPerte({
      magasinIds: utilisateur.magasins,
      ...this.periode(debut, fin),
    });
  }

  /** Ecarts de caisse par caissier (M9). */
  @Get('ecarts-de-caisse')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  ecartsDeCaisse(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('jours') jours?: string,
  ) {
    return this.rapports.ecartsDeCaisse({
      magasinIds: utilisateur.magasins,
      jours: jours ? Number(jours) : 30,
    });
  }

  /** Journal des annulations et des remises (M9). */
  @Get('annulations-et-remises')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  annulationsEtRemises(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
  ) {
    return this.rapports.annulationsEtRemises({
      magasinIds: utilisateur.magasins,
      ...this.periode(debut, fin),
    });
  }

  /** Resumes quotidiens deja produits (M9). */
  @Get('resumes')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  resumes(@Utilisateur() utilisateur: UtilisateurConnecte, @Query('limite') limite?: string) {
    return this.resume.liste(utilisateur.magasins, limite ? Number(limite) : 30);
  }

  /** Reglages de l'envoi automatique, mot de passe exclu (M9). */
  @Get('resumes/reglages')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  async reglagesResume(@Utilisateur() utilisateur: UtilisateurConnecte) {
    const reglages = await this.resume.reglages(utilisateur.magasins[0]);
    const { motDePasse, ...sansSecret } = reglages;
    void motDePasse;
    return { ...sansSecret, motDePasseEnregistre: Boolean(motDePasse) };
  }

  /**
   * Produit le resume d'un jour a la demande.
   *
   * Sert a l'installation, pour verifier le relais de messagerie sans
   * attendre le lendemain matin, et a rattraper une journee dont le
   * resume a echoue.
   */
  @Post('resumes')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  produireResume(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Body() corps: { jour?: string; magasinId?: string },
  ) {
    const magasinId = corps.magasinId ?? utilisateur.magasins[0];
    if (!magasinId || !utilisateur.magasins.includes(magasinId)) {
      throw new BadRequestException('Ce magasin ne fait pas partie des votres');
    }
    const jour = corps.jour ? new Date(corps.jour) : veille();
    if (Number.isNaN(jour.getTime())) {
      throw new BadRequestException('Date illisible');
    }
    return this.resume.produireEtEnvoyer(magasinId, jour);
  }

  /**
   * Export de n'importe quel rapport en Excel ou en PDF (M9).
   *
   * Une seule route plutot qu'une par rapport et par format : la mise
   * en forme est decrite une fois dans presentation.ts, donc l'export
   * ne peut pas s'ecarter de ce que montre l'ecran.
   */
  @Get(':nom/export.:format')
  @Droits(PERMISSIONS.RAPPORT_SON_MAGASIN)
  async exporter(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Param('nom') nom: string,
    @Param('format') format: string,
    @Res({ passthrough: true }) reponse: Response,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
    @Query('sens') sens?: 'TOP' | 'FLOP',
    @Query('jours') jours?: string,
    @Query('limite') limite?: string,
  ): Promise<StreamableFile> {
    if (format !== 'xlsx' && format !== 'pdf') {
      throw new BadRequestException(
        `Format « ${format} » inconnu : seuls xlsx et pdf sont produits`,
      );
    }
    const rapport = await this.composer(utilisateur, nom, {
      debut, fin, sens, jours, limite,
    });

    const contenu = format === 'xlsx' ? await enExcel(rapport) : await enPdf(rapport);
    const nomFichier = nomDeFichier(rapport.titre, format);

    reponse.set({
      'Content-Type': format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/pdf',
      'Content-Disposition': `attachment; filename="${nomFichier}"`,
      'Content-Length': String(contenu.length),
    });
    return new StreamableFile(contenu);
  }

  /** Assemble le rapport demande dans sa forme presentable. */
  private async composer(
    utilisateur: UtilisateurConnecte,
    nom: string,
    options: {
      debut?: string; fin?: string;
      sens?: 'TOP' | 'FLOP'; jours?: string; limite?: string;
    },
  ): Promise<Rapport> {
    const magasinIds = utilisateur.magasins;

    switch (nom) {
      case 'periode': {
        const periode = this.periode(options.debut, options.fin);
        return presentation.synthesePeriode(
          await this.rapports.periode({ magasinIds, ...periode }),
        );
      }
      case 'produits': {
        const periode = this.periode(options.debut, options.fin);
        const sens = options.sens === 'FLOP' ? 'FLOP' : 'TOP';
        return presentation.palmaresProduits(
          sens, periode,
          await this.rapports.produits({
            magasinIds, ...periode, sens,
            limite: options.limite ? Number(options.limite) : 50,
          }),
        );
      }
      case 'dormants': {
        const jours = options.jours ? Number(options.jours) : 90;
        return presentation.produitsDormants(
          jours, await this.rapports.dormants({ magasinIds, jours }),
        );
      }
      case 'ruptures':
        return presentation.ruptures(
          await this.rapports.ruptures({
            magasinIds, limite: options.limite ? Number(options.limite) : undefined,
          }),
        );
      case 'ventes-a-perte':
        return presentation.ventesAPerte(
          await this.rapports.ventesAPerte({
            magasinIds, ...this.periode(options.debut, options.fin),
          }),
        );
      case 'ecarts-de-caisse':
        return presentation.ecartsDeCaisse(
          await this.rapports.ecartsDeCaisse({
            magasinIds, jours: options.jours ? Number(options.jours) : 30,
          }),
        );
      case 'annulations-et-remises':
        return presentation.annulationsEtRemises(
          await this.rapports.annulationsEtRemises({
            magasinIds, ...this.periode(options.debut, options.fin),
          }),
        );
      default:
        throw new BadRequestException(
          `Rapport « ${nom} » inconnu. Disponibles : periode, produits, dormants, `
          + 'ruptures, ventes-a-perte, ecarts-de-caisse, annulations-et-remises',
        );
    }
  }
}

/** La veille : journee par defaut du resume. */
function veille(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}
