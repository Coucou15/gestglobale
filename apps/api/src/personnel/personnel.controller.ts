import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch,
  Post, Query, Res, StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { StatutAbsence, TypeAbsence, TypeContrat } from '@prisma/client';
import {
  IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength,
} from 'class-validator';
import { PersonnelService } from './personnel.service';
import { PaieService } from './paie.service';
import * as presentation from './presentation';
import { PrismaService } from '../prisma/prisma.service';
import { Droits, Utilisateur, type UtilisateurConnecte } from '../auth/droits.decorator';
import { PERMISSIONS } from '@gestglobale/shared';
import { nomDeFichier } from '../rapports/tableau';
import { enCsv, enExcel, enPdf } from '../rapports/exports';

class ContratDto {
  @IsEnum(TypeContrat) type: TypeContrat;
  @IsString() debut: string;
  @IsOptional() @IsString() fin?: string;
  @IsInt() @Min(1) salaireBaseCentimes: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) heuresParSemaine?: number;
  @IsOptional() @IsArray() primesFixes?: Array<{
    code: string; libelle: string; montantCentimes: number;
  }>;
}

class SortieDto {
  @IsString() dateSortie: string;
  @IsString() @MinLength(3) motif: string;
}

class PointageDto {
  @IsString() employeId: string;
  @IsEnum(['ENTREE', 'SORTIE'] as const) sens: 'ENTREE' | 'SORTIE';
  @IsOptional() @IsString() instant?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsBoolean() horsLigne?: boolean;
}

class AbsenceDto {
  @IsString() employeId: string;
  @IsEnum(TypeAbsence) type: TypeAbsence;
  @IsString() debut: string;
  @IsString() fin: string;
  @IsOptional() @IsString() motif?: string;
}

class AvanceDto {
  @IsString() employeId: string;
  @IsString() compteId: string;
  @IsInt() @Min(1) montantCentimes: number;
  @IsOptional() @IsString() motif?: string;
}

class PlanningDto {
  @IsString() magasinId: string;
  @IsString() employeId: string;
  @IsString() date: string;
  @IsString() heureDebut: string;
  @IsString() heureFin: string;
  @IsOptional() @IsString() poste?: string;
}

class PaieDto {
  @IsString() employeId: string;
  @IsInt() @Min(2000) annee: number;
  @IsInt() @Min(1) @Max(12) mois: number;
  @IsOptional() @IsArray() retenuesDiverses?: Array<{
    libelle: string; montantCentimes: number; origine: string;
  }>;
}

/**
 * Gestion du personnel (M13).
 *
 * La confidentialite de la section 6 est portee ici : les dossiers et
 * les salaires sont reserves au gerant et au comptable, tandis que
 * chaque employe accede a ses propres bulletins et a son solde de
 * conges — et a rien d'autre.
 */
@ApiTags('M13 — Personnel')
@Controller('personnel')
export class PersonnelController {
  constructor(
    private readonly personnel: PersonnelService,
    private readonly paie: PaieService,
    private readonly prisma: PrismaService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Espace personnel : ce que chacun voit de lui-meme                 */
  /* ---------------------------------------------------------------- */

  /**
   * Dossier de l'utilisateur connecte.
   *
   * Aucun droit particulier : chacun a le droit de consulter ses
   * propres bulletins et son solde de conges, y compris depuis son
   * telephone. C'est ce que demande la section 6, et c'est la seule
   * route du module qui ne passe pas par « personnel.voir ».
   */
  @Get('moi')
  @Droits(PERMISSIONS.PERSONNEL_SES_DOCUMENTS)
  async moi(@Utilisateur() utilisateur: UtilisateurConnecte) {
    const compte = await this.prisma.utilisateur.findUnique({
      where: { id: utilisateur.id },
      select: {
        employe: {
          select: {
            id: true, matricule: true, nom: true, prenom: true, poste: true,
            dateEmbauche: true, soldeCongesJours: true,
            magasin: { select: { code: true, nom: true } },
            contrats: {
              where: { actif: true }, orderBy: { debut: 'desc' }, take: 1,
              select: { type: true, debut: true, fin: true, heuresParSemaine: true },
            },
          },
        },
      },
    });

    if (!compte?.employe) {
      // Un compte sans dossier employe n'est pas une erreur : le gerant
      // lui-meme peut n'en avoir aucun.
      return { employe: null, bulletins: [], absences: [] };
    }

    const [bulletins, absences] = await Promise.all([
      this.paie.bulletinsDe(compte.employe.id),
      this.prisma.absence.findMany({
        where: { employeId: compte.employe.id },
        orderBy: { debut: 'desc' },
        take: 50,
      }),
    ]);

    return { employe: compte.employe, bulletins, absences };
  }

  /* ---------------------------------------------------------------- */
  /* Dossiers                                                         */
  /* ---------------------------------------------------------------- */

  @Get('employes')
  @Droits(PERMISSIONS.PERSONNEL_VOIR)
  employes(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('inactifs') inactifs?: string,
    @Query('texte') texte?: string,
  ) {
    return this.personnel.employes({
      magasinIds: utilisateur.magasins,
      inactifs: inactifs === 'true',
      texte,
    });
  }

  @Get('employes/:id')
  @Droits(PERMISSIONS.PERSONNEL_VOIR)
  employe(@Utilisateur() utilisateur: UtilisateurConnecte, @Param('id') id: string) {
    return this.personnel.employe(id, utilisateur.magasins);
  }

  @Post('employes')
  @Droits(PERMISSIONS.PERSONNEL_GERER)
  creer(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Body() donnees: Record<string, unknown>,
  ) {
    if (!donnees.nom || !donnees.prenom) {
      throw new BadRequestException('Le nom et le prenom sont obligatoires');
    }
    return this.personnel.creerEmploye({
      donnees, magasinIds: utilisateur.magasins, utilisateurId: utilisateur.id,
    });
  }

  @Patch('employes/:id')
  @Droits(PERMISSIONS.PERSONNEL_GERER)
  modifier(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Param('id') id: string,
    @Body() donnees: Record<string, unknown>,
  ) {
    return this.personnel.modifierEmploye(id, donnees, utilisateur.id);
  }

  /** Sortie d'un employe : ses acces tombent dans la meme transaction. */
  @Post('employes/:id/sortie')
  @Droits(PERMISSIONS.PERSONNEL_GERER)
  sortir(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Param('id') id: string,
    @Body() dto: SortieDto,
  ) {
    return this.personnel.sortir({ id, ...dto, utilisateurId: utilisateur.id });
  }

  @Post('employes/:id/compte')
  @Droits(PERMISSIONS.PERSONNEL_GERER)
  rattacher(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Param('id') id: string,
    @Body() dto: { utilisateurId: string | null },
  ) {
    return this.personnel.rattacherCompte(id, dto.utilisateurId, utilisateur.id);
  }

  @Post('employes/:id/contrats')
  @Droits(PERMISSIONS.PERSONNEL_GERER)
  contrat(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Param('id') id: string,
    @Body() dto: ContratDto,
  ) {
    return this.personnel.ajouterContrat({
      employeId: id, ...dto, utilisateurId: utilisateur.id,
    });
  }

  /** Contrats a terme dans les trente jours (M13). */
  @Get('alertes-contrats')
  @Droits(PERMISSIONS.PERSONNEL_VOIR)
  alertes(@Utilisateur() utilisateur: UtilisateurConnecte, @Query('jours') jours?: string) {
    return this.personnel.alertesContrats(
      utilisateur.magasins, jours ? Number(jours) : 30,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Pointage, plannings, absences                                    */
  /* ---------------------------------------------------------------- */

  @Post('pointages')
  @Droits(PERMISSIONS.PERSONNEL_VOIR)
  pointer(@Body() dto: PointageDto) {
    return this.personnel.pointer(dto);
  }

  @Get('pointages')
  @Droits(PERMISSIONS.PERSONNEL_VOIR)
  pointages(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
    @Query('employeId') employeId?: string,
  ) {
    return this.personnel.pointages({
      magasinIds: utilisateur.magasins, ...this.periode(debut, fin), employeId,
    });
  }

  @Get('planning')
  @Droits(PERMISSIONS.PERSONNEL_VOIR)
  planning(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('magasinId') magasinId?: string,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
  ) {
    const magasin = magasinId ?? utilisateur.magasins[0];
    if (!magasin || !utilisateur.magasins.includes(magasin)) {
      throw new BadRequestException('Ce magasin ne fait pas partie des votres');
    }
    return this.personnel.planning({ magasinId: magasin, ...this.periode(debut, fin) });
  }

  @Post('planning')
  @Droits(PERMISSIONS.PERSONNEL_GERER)
  planifier(@Utilisateur() utilisateur: UtilisateurConnecte, @Body() dto: PlanningDto) {
    if (!utilisateur.magasins.includes(dto.magasinId)) {
      throw new BadRequestException('Ce magasin ne fait pas partie des votres');
    }
    return this.personnel.planifier({ ...dto, utilisateurId: utilisateur.id });
  }

  @Post('planning/:id/echange')
  @Droits(PERMISSIONS.PERSONNEL_VOIR)
  echanger(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Param('id') id: string,
    @Body() dto: { avecEmployeId: string; valide?: boolean },
  ) {
    // Valider un echange est un geste du gerant ; le demander ne l'est
    // pas. Le droit se verifie donc selon l'intention.
    if (dto.valide && !utilisateur.permissions.includes(PERMISSIONS.PERSONNEL_GERER)) {
      throw new ForbiddenException(
        'Un echange de poste doit etre valide par un responsable',
      );
    }
    return this.personnel.echangerPoste({
      planningId: id,
      avecEmployeId: dto.avecEmployeId,
      valide: Boolean(dto.valide),
      utilisateurId: utilisateur.id,
    });
  }

  @Get('absences')
  @Droits(PERMISSIONS.PERSONNEL_VOIR)
  absences(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('statut') statut?: string,
    @Query('employeId') employeId?: string,
  ) {
    if (statut && !(statut in StatutAbsence)) {
      throw new BadRequestException('Statut inconnu : DEMANDEE, VALIDEE ou REFUSEE');
    }
    return this.personnel.absences({
      magasinIds: utilisateur.magasins,
      statut: statut as StatutAbsence | undefined,
      employeId,
    });
  }

  @Post('absences')
  @Droits(PERMISSIONS.PERSONNEL_VOIR)
  demander(@Utilisateur() utilisateur: UtilisateurConnecte, @Body() dto: AbsenceDto) {
    return this.personnel.demanderAbsence({ ...dto, utilisateurId: utilisateur.id });
  }

  @Post('absences/:id/validation')
  @Droits(PERMISSIONS.PERSONNEL_GERER)
  valider(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Param('id') id: string,
    @Body() dto: { accepte: boolean },
  ) {
    return this.personnel.validerAbsence({
      id, accepte: Boolean(dto.accepte), utilisateurId: utilisateur.id,
    });
  }

  @Post('avances')
  @Droits(PERMISSIONS.PERSONNEL_PAIE)
  avance(@Utilisateur() utilisateur: UtilisateurConnecte, @Body() dto: AvanceDto) {
    return this.personnel.avance({ ...dto, utilisateurId: utilisateur.id });
  }

  /* ---------------------------------------------------------------- */
  /* Paie                                                             */
  /* ---------------------------------------------------------------- */

  @Get('paie/bareme')
  @Droits(PERMISSIONS.PERSONNEL_PAIE)
  bareme(@Utilisateur() utilisateur: UtilisateurConnecte) {
    return this.personnel.bareme(utilisateur.magasins[0]);
  }

  @Post('paie/preparer')
  @Droits(PERMISSIONS.PERSONNEL_PAIE)
  preparer(@Body() dto: PaieDto) {
    return this.paie.preparer(dto);
  }

  @Post('paie/etablir')
  @Droits(PERMISSIONS.PERSONNEL_PAIE)
  etablir(@Utilisateur() utilisateur: UtilisateurConnecte, @Body() dto: PaieDto) {
    return this.paie.etablir({ ...dto, utilisateurId: utilisateur.id });
  }

  @Post('paie/bulletins/:id/versement')
  @Droits(PERMISSIONS.PERSONNEL_PAIE)
  verser(@Utilisateur() utilisateur: UtilisateurConnecte, @Param('id') id: string) {
    return this.paie.verser(id, utilisateur.id);
  }

  @Get('paie/livre')
  @Droits(PERMISSIONS.PERSONNEL_PAIE)
  livre(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('annee') annee?: string,
    @Query('mois') mois?: string,
  ) {
    return this.paie.livreDePaie({
      magasinIds: utilisateur.magasins, ...this.moisDemande(annee, mois),
    });
  }

  @Get('performance')
  @Droits(PERMISSIONS.PERSONNEL_VOIR)
  performance(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
    @Query('employeId') employeId?: string,
  ) {
    return this.paie.performance({
      magasinIds: utilisateur.magasins, ...this.periode(debut, fin), employeId,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Documents                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Bulletin de paie en PDF.
   *
   * Accessible au gerant, au comptable — et a l'employe pour son propre
   * bulletin, sans autre droit : c'est le sien.
   */
  @Get('paie/bulletins/:id/document.:format')
  @Droits(PERMISSIONS.PERSONNEL_SES_DOCUMENTS)
  async documentBulletin(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Param('id') id: string,
    @Param('format') format: string,
    @Res({ passthrough: true }) reponse: Response,
  ): Promise<StreamableFile> {
    const bulletin = await this.paie.bulletin(id);
    await this.verifierAccesAuDossier(utilisateur, bulletin.employe.id);

    const rapport = presentation.bulletinDePaie(bulletin as never);
    return this.rendre(rapport, format, reponse, 'portrait');
  }

  @Get('employes/:id/attestation.:format')
  @Droits(PERMISSIONS.PERSONNEL_SES_DOCUMENTS)
  async attestation(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Param('id') id: string,
    @Param('format') format: string,
    @Res({ passthrough: true }) reponse: Response,
    @Query('certificat') certificat?: string,
  ): Promise<StreamableFile> {
    await this.verifierAccesAuDossier(utilisateur, id);

    const [employe, societe] = await Promise.all([
      this.prisma.employe.findUnique({
        where: { id },
        include: { contrats: { where: { actif: true }, orderBy: { debut: 'desc' }, take: 1 } },
      }),
      this.prisma.societe.findFirst(),
    ]);
    if (!employe) throw new BadRequestException('Employe introuvable');

    const estCertificat = certificat === 'true';
    if (estCertificat && employe.actif) {
      throw new BadRequestException(
        'Un certificat de travail se delivre a un employe sorti. '
        + 'Pour un employe en poste, c’est une attestation de travail.',
      );
    }

    const rapport = presentation.attestationDeTravail({
      employe,
      societe: societe ?? { raisonSociale: 'L’entreprise' },
      contrat: employe.contrats[0] ?? null,
      certificat: estCertificat,
    });
    return this.rendre(rapport, format, reponse, 'portrait');
  }

  @Get('paie/livre/export.:format')
  @Droits(PERMISSIONS.PERSONNEL_PAIE)
  async exporterLivre(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Param('format') format: string,
    @Res({ passthrough: true }) reponse: Response,
    @Query('annee') annee?: string,
    @Query('mois') mois?: string,
  ): Promise<StreamableFile> {
    const livre = await this.paie.livreDePaie({
      magasinIds: utilisateur.magasins, ...this.moisDemande(annee, mois),
    });
    return this.rendre(presentation.livreDePaie(livre), format, reponse);
  }

  @Get('performance/export.:format')
  @Droits(PERMISSIONS.PERSONNEL_VOIR)
  async exporterPerformance(
    @Utilisateur() utilisateur: UtilisateurConnecte,
    @Param('format') format: string,
    @Res({ passthrough: true }) reponse: Response,
    @Query('debut') debut?: string,
    @Query('fin') fin?: string,
  ): Promise<StreamableFile> {
    const donnees = await this.paie.performance({
      magasinIds: utilisateur.magasins, ...this.periode(debut, fin),
    });
    return this.rendre(presentation.performance(donnees), format, reponse);
  }

  /* ---------------------------------------------------------------- */

  /**
   * Un employe n'accede qu'a son propre dossier.
   *
   * Le gerant et le comptable, qui portent « personnel.voir », accedent
   * a tous. C'est exactement la regle de confidentialite de la
   * section 6, et elle se verifie ici plutot que dans chaque route.
   */
  private async verifierAccesAuDossier(
    utilisateur: UtilisateurConnecte,
    employeId: string,
  ): Promise<void> {
    if (utilisateur.permissions.includes(PERMISSIONS.PERSONNEL_VOIR)) return;

    const compte = await this.prisma.utilisateur.findUnique({
      where: { id: utilisateur.id },
      select: { employe: { select: { id: true } } },
    });
    if (compte?.employe?.id !== employeId) {
      throw new ForbiddenException(
        'Vous ne pouvez consulter que vos propres documents',
      );
    }
  }

  private async rendre(
    rapport: ReturnType<typeof presentation.livreDePaie>,
    format: string,
    reponse: Response,
    orientation: 'paysage' | 'portrait' = 'paysage',
  ): Promise<StreamableFile> {
    if (format !== 'pdf' && format !== 'xlsx' && format !== 'csv') {
      throw new BadRequestException(
        `Format « ${format} » inconnu : seuls pdf, xlsx et csv sont produits`,
      );
    }
    const contenu = format === 'pdf'
      ? await enPdf(rapport, { orientation })
      : format === 'xlsx' ? await enExcel(rapport) : enCsv(rapport);

    reponse.set({
      'Content-Type': format === 'pdf'
        ? 'application/pdf'
        : format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomDeFichier(rapport.titre, format)}"`,
      'Content-Length': String(contenu.length),
    });
    return new StreamableFile(contenu);
  }

  private periode(debut?: string, fin?: string): { debut: Date; fin: Date } {
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

  private moisDemande(annee?: string, mois?: string): { annee: number; mois: number } {
    const maintenant = new Date();
    return {
      annee: annee ? Number(annee) : maintenant.getFullYear(),
      mois: mois ? Number(mois) : maintenant.getMonth() + 1,
    };
  }
}
