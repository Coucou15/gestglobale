import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TypeAbsence } from '@prisma/client';
import {
  calculerBulletin, formaterDA,
  type BaremePaie, type Prime, type Retenue,
} from '@gestglobale/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PersonnelService } from './personnel.service';
import { NumerotationService } from '../commun/numerotation.service';
import { AuditService } from '../audit/audit.service';
import { b, c } from '../commun/bigint';

/**
 * Paie (M13).
 *
 * Un bulletin se compose de faits deja enregistres ailleurs : le
 * contrat donne le salaire de base et les primes fixes, le pointage
 * donne les heures, les absences donnent les retenues, les avances
 * donnent ce qu'il reste a rembourser, les clotures donnent les ecarts
 * de caisse. Rien n'est saisi deux fois.
 *
 * Le calcul lui-meme vit dans le noyau partage, avec ses tests : il doit
 * pouvoir etre rejoue et verifie sans base de donnees. Les taux
 * appliques sont graves sur le bulletin, pour qu'un bulletin ancien
 * reste justifiable apres un changement de bareme.
 */
@Injectable()
export class PaieService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly personnel: PersonnelService,
    private readonly numerotation: NumerotationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Prepare un bulletin sans l'enregistrer.
   *
   * Le gerant doit pouvoir regarder ce que donnerait la paie avant de
   * la figer : un bulletin enregistre par erreur se corrige mal.
   */
  async preparer(params: {
    employeId: string; annee: number; mois: number;
    /**
     * Bulletin en cours de recalcul, s'il existe deja.
     *
     * Les avances qu'il a deja absorbees doivent rester dans son calcul,
     * sinon le recalcul les oublie : l'avance reste marquee remboursee
     * et le salaire repart entier. L'employe garderait l'argent deux
     * fois.
     */
    bulletinId?: string;
  }) {
    const employe = await this.prisma.employe.findUnique({
      where: { id: params.employeId },
      include: {
        magasin: { select: { id: true, code: true, nom: true } },
        contrats: { where: { actif: true }, orderBy: { debut: 'desc' }, take: 1 },
        utilisateur: { select: { id: true } },
      },
    });
    if (!employe) throw new NotFoundException('Employe introuvable');

    const contrat = employe.contrats[0];
    if (!contrat) {
      throw new BadRequestException(
        `${employe.prenom} ${employe.nom} n’a pas de contrat actif : `
        + 'enregistrez son contrat avant de preparer sa paie',
      );
    }

    const debut = new Date(params.annee, params.mois - 1, 1);
    const fin = new Date(params.annee, params.mois, 1);
    const bareme = await this.chargerBareme(employe.magasinId, contrat.heuresParSemaine);

    const [pointages, absences, avances, ecarts] = await Promise.all([
      this.prisma.pointage.findMany({
        where: { employeId: params.employeId, date: { gte: debut, lt: fin } },
        select: { minutesTravaillees: true, minutesRetard: true },
      }),
      this.prisma.absence.findMany({
        where: {
          employeId: params.employeId,
          statut: 'VALIDEE',
          debut: { lt: fin },
          fin: { gte: debut },
        },
        select: { type: true, nombreJours: true },
      }),
      // Avances a rembourser : celles qui ne sont rattachees a aucun
      // bulletin, plus celles que ce bulletin-ci absorbe deja quand on
      // le recalcule.
      this.prisma.avanceSalaire.findMany({
        where: {
          employeId: params.employeId,
          OR: [
            { bulletinId: null },
            ...(params.bulletinId ? [{ bulletinId: params.bulletinId }] : []),
          ],
        },
        select: { id: true, numero: true, montantCentimes: true, rembourseCentimes: true },
      }),
      this.ecartsDeCaisse(employe.utilisateur?.id ?? null, debut, fin),
    ]);

    const heuresTravaillees = Math.round(
      (pointages.reduce((t, p) => t + p.minutesTravaillees, 0) / 60) * 100,
    ) / 100;
    const minutesRetard = pointages.reduce((t, p) => t + p.minutesRetard, 0);

    // Seules les absences non remunerees se retiennent : un conge annuel
    // valide et une maladie justifiee sont payes.
    const joursNonPayes = absences
      .filter((a) => a.type === TypeAbsence.INJUSTIFIEE)
      .reduce((t, a) => t + a.nombreJours, 0);

    const primes = (contrat.primesFixes as unknown as Prime[] | null) ?? [];
    // Pour une avance deja absorbee par ce bulletin, c'est son montant
    // qu'il faut reprendre : son « reste » est a zero precisement parce
    // que ce bulletin la retient.
    const resteAvances = avances.reduce((t, a) => {
      const reste = c(a.montantCentimes) - c(a.rembourseCentimes);
      return t + (reste > 0 ? reste : c(a.montantCentimes));
    }, 0);

    const bulletin = calculerBulletin({
      salaireBaseCentimes: c(contrat.salaireBaseCentimes),
      heuresTravaillees,
      joursOuvrables: this.joursOuvrables(params.annee, params.mois),
      joursAbsenceNonPayee: joursNonPayes,
      primes,
      avancesCentimes: resteAvances,
      ecartsDeCaisseCentimes: ecarts.manquantsCentimes,
    }, bareme);

    return {
      employe: {
        id: employe.id,
        matricule: employe.matricule,
        nom: employe.nom,
        prenom: employe.prenom,
        poste: employe.poste,
        magasin: employe.magasin,
      },
      periode: { annee: params.annee, mois: params.mois },
      contrat: {
        type: contrat.type,
        salaireBaseCentimes: c(contrat.salaireBaseCentimes),
        heuresParSemaine: contrat.heuresParSemaine,
      },
      entrees: {
        heuresTravaillees,
        joursPointes: pointages.length,
        minutesRetard,
        joursAbsenceNonPayee: joursNonPayes,
        joursOuvrables: this.joursOuvrables(params.annee, params.mois),
        avancesACombler: avances.map((a) => {
          const reste = c(a.montantCentimes) - c(a.rembourseCentimes);
          return {
            id: a.id,
            numero: a.numero,
            resteCentimes: reste > 0 ? reste : c(a.montantCentimes),
          };
        }),
        ecartsDeCaisse: ecarts,
      },
      bareme,
      bulletin,
    };
  }

  /**
   * Fige un bulletin.
   *
   * Idempotent par employe et par mois : relancer la paie d'un mois deja
   * paye ne cree pas un second bulletin. Un bulletin deja verse ne se
   * recalcule pas non plus — ce serait reecrire une somme que l'employe
   * a touchee.
   */
  async etablir(params: {
    employeId: string; annee: number; mois: number;
    retenuesDiverses?: Retenue[]; utilisateurId: string;
  }) {
    const existant = await this.prisma.bulletinPaie.findUnique({
      where: {
        employeId_periodeAnnee_periodeMois: {
          employeId: params.employeId,
          periodeAnnee: params.annee,
          periodeMois: params.mois,
        },
      },
    });
    if (existant?.payeLe) {
      throw new BadRequestException(
        `Le bulletin ${existant.numero} est deja verse : il ne se recalcule pas. `
        + 'Corrigez par une regularisation sur la paie suivante.',
      );
    }

    const prepare = await this.preparer({ ...params, bulletinId: existant?.id });
    const bareme = prepare.bareme;

    // Les retenues saisies a la main entrent dans le calcul, elles ne
    // s'ajoutent pas apres coup.
    const bulletin = params.retenuesDiverses?.length
      ? calculerBulletin({
        salaireBaseCentimes: prepare.contrat.salaireBaseCentimes,
        heuresTravaillees: prepare.entrees.heuresTravaillees,
        joursOuvrables: prepare.entrees.joursOuvrables,
        joursAbsenceNonPayee: prepare.entrees.joursAbsenceNonPayee,
        primes: (prepare.bulletin.primesCentimes > 0
          ? ((await this.primesDuContrat(params.employeId)) ?? []) : []),
        avancesCentimes: prepare.entrees.avancesACombler
          .reduce((t, a) => t + a.resteCentimes, 0),
        ecartsDeCaisseCentimes: prepare.entrees.ecartsDeCaisse.manquantsCentimes,
        retenuesDiverses: params.retenuesDiverses,
      }, bareme)
      : prepare.bulletin;

    return this.prisma.$transaction(async (tx) => {
      const numero = existant?.numero
        ?? await this.numerotation.suivant('PAIE', { tx });

      const donnees = {
        numero,
        employeId: params.employeId,
        periodeAnnee: params.annee,
        periodeMois: params.mois,
        salaireBaseCentimes: b(bulletin.salaireBaseCentimes),
        heuresSupplementaires: Math.round(bulletin.heuresSupplementaires),
        heuresSupCentimes: b(bulletin.heuresSupCentimes),
        primesCentimes: b(bulletin.primesCentimes),
        retenues: bulletin.retenues as unknown as Prisma.InputJsonValue,
        retenuesCentimes: b(bulletin.retenuesCentimes),
        brutCentimes: b(bulletin.brutCentimes),
        cotisationsCentimes: b(bulletin.cotisationsCentimes),
        irgCentimes: b(bulletin.irgCentimes),
        netAPayerCentimes: b(bulletin.netAPayerCentimes),
        // Les taux sont graves : un bulletin de l'an dernier doit rester
        // justifiable apres un changement de bareme.
        tauxAppliques: bareme as unknown as Prisma.InputJsonValue,
      };

      const enregistre = existant
        ? await tx.bulletinPaie.update({ where: { id: existant.id }, data: donnees })
        : await tx.bulletinPaie.create({ data: donnees });

      // Les avances remboursees par ce bulletin lui sont rattachees :
      // elles ne reviendront pas sur la paie suivante.
      if (bulletin.retenues.some((r) => r.origine === 'AVANCE')) {
        await tx.avanceSalaire.updateMany({
          where: { employeId: params.employeId, bulletinId: null },
          data: { bulletinId: enregistre.id },
        });
        const avances = await tx.avanceSalaire.findMany({
          where: { bulletinId: enregistre.id },
          select: { id: true, montantCentimes: true },
        });
        for (const avance of avances) {
          await tx.avanceSalaire.update({
            where: { id: avance.id },
            data: { rembourseCentimes: avance.montantCentimes },
          });
        }
      }

      await this.audit.journaliser({
        utilisateurId: params.utilisateurId,
        action: 'personnel.bulletin_etabli',
        entite: 'BulletinPaie',
        entiteId: enregistre.id,
        details: {
          numero,
          employeId: params.employeId,
          periode: `${params.mois}/${params.annee}`,
          netAPayerCentimes: bulletin.netAPayerCentimes,
        },
      });

      return this.bulletinEnSortie(enregistre, prepare.employe);
    });
  }

  /** Marque un bulletin comme verse. */
  async verser(id: string, utilisateurId: string) {
    const bulletin = await this.prisma.bulletinPaie.findUnique({ where: { id } });
    if (!bulletin) throw new NotFoundException('Bulletin introuvable');
    if (bulletin.payeLe) throw new BadRequestException('Ce bulletin est deja verse');

    const maj = await this.prisma.bulletinPaie.update({
      where: { id },
      data: { payeLe: new Date() },
      include: {
        employe: {
          select: { id: true, matricule: true, nom: true, prenom: true, poste: true },
        },
      },
    });
    await this.audit.journaliser({
      utilisateurId,
      action: 'personnel.bulletin_verse',
      entite: 'BulletinPaie',
      entiteId: id,
      details: { numero: bulletin.numero, netAPayerCentimes: c(bulletin.netAPayerCentimes) },
    });
    return this.bulletinEnSortie(maj, maj.employe);
  }

  /** Livre de paie : tous les bulletins d'un mois. */
  async livreDePaie(params: { magasinIds: string[]; annee: number; mois: number }) {
    const bulletins = await this.prisma.bulletinPaie.findMany({
      where: {
        periodeAnnee: params.annee,
        periodeMois: params.mois,
        employe: { OR: [{ magasinId: { in: params.magasinIds } }, { magasinId: null }] },
      },
      orderBy: { employe: { nom: 'asc' } },
      include: {
        employe: {
          select: {
            matricule: true, nom: true, prenom: true, poste: true,
            numeroSecuriteSociale: true,
            magasin: { select: { code: true } },
          },
        },
      },
    });

    const lignes = bulletins.map((bu) => ({
      numero: bu.numero,
      matricule: bu.employe.matricule,
      nom: `${bu.employe.prenom} ${bu.employe.nom}`,
      poste: bu.employe.poste,
      magasin: bu.employe.magasin?.code ?? null,
      numeroSecuriteSociale: bu.employe.numeroSecuriteSociale,
      salaireBaseCentimes: c(bu.salaireBaseCentimes),
      heuresSupplementaires: bu.heuresSupplementaires,
      heuresSupCentimes: c(bu.heuresSupCentimes),
      primesCentimes: c(bu.primesCentimes),
      brutCentimes: c(bu.brutCentimes),
      cotisationsCentimes: c(bu.cotisationsCentimes),
      irgCentimes: c(bu.irgCentimes),
      retenuesCentimes: c(bu.retenuesCentimes),
      netAPayerCentimes: c(bu.netAPayerCentimes),
      payeLe: bu.payeLe,
    }));

    const somme = (champ: keyof (typeof lignes)[number]) =>
      lignes.reduce((t, l) => t + Number(l[champ] ?? 0), 0);

    return {
      periode: { annee: params.annee, mois: params.mois },
      lignes,
      totaux: {
        nombreBulletins: lignes.length,
        nombreVerses: lignes.filter((l) => l.payeLe).length,
        salaireBaseCentimes: somme('salaireBaseCentimes'),
        heuresSupCentimes: somme('heuresSupCentimes'),
        primesCentimes: somme('primesCentimes'),
        brutCentimes: somme('brutCentimes'),
        cotisationsCentimes: somme('cotisationsCentimes'),
        irgCentimes: somme('irgCentimes'),
        retenuesCentimes: somme('retenuesCentimes'),
        netAPayerCentimes: somme('netAPayerCentimes'),
      },
    };
  }

  /** Bulletins d'un employe, pour son espace personnel. */
  async bulletinsDe(employeId: string) {
    const bulletins = await this.prisma.bulletinPaie.findMany({
      where: { employeId },
      orderBy: [{ periodeAnnee: 'desc' }, { periodeMois: 'desc' }],
      include: {
        employe: {
          select: { id: true, matricule: true, nom: true, prenom: true, poste: true },
        },
      },
    });
    return bulletins.map((bu) => this.bulletinEnSortie(bu, bu.employe));
  }

  async bulletin(id: string) {
    const bulletin = await this.prisma.bulletinPaie.findUnique({
      where: { id },
      include: {
        employe: {
          select: {
            id: true, matricule: true, nom: true, prenom: true, poste: true,
            numeroSecuriteSociale: true, magasinId: true,
            magasin: { select: { code: true, nom: true } },
          },
        },
        avances: { select: { numero: true, montantCentimes: true } },
      },
    });
    if (!bulletin) throw new NotFoundException('Bulletin introuvable');
    return this.bulletinEnSortie(bulletin, bulletin.employe);
  }

  /**
   * Performance d'un employe sur une periode (M13).
   *
   * Ventes encaissees, tickets, annulations, remises, ecarts de caisse
   * et ponctualite. Ces chiffres se lisent ensemble : un caissier rapide
   * qui annule beaucoup n'est pas forcement un bon caissier, et un
   * ecart de caisse est en partie structurel.
   */
  async performance(params: {
    magasinIds: string[]; debut: Date; fin: Date; employeId?: string;
  }) {
    const employes = await this.prisma.employe.findMany({
      where: {
        actif: true,
        ...(params.employeId ? { id: params.employeId } : {}),
        OR: [{ magasinId: { in: params.magasinIds } }, { magasinId: null }],
      },
      select: {
        id: true, matricule: true, nom: true, prenom: true, poste: true,
        utilisateur: { select: { id: true, code: true } },
      },
    });

    const lignes = await Promise.all(employes.map(async (e) => {
      const utilisateurId = e.utilisateur?.id ?? null;
      const [ventes, pointages, ecarts] = await Promise.all([
        utilisateurId
          ? this.prisma.$queryRaw<Array<{
            tickets: bigint; ca: bigint | null; annulations: bigint;
            remises: bigint | null; lignes_remisees: bigint;
          }>>`
            SELECT COUNT(*) FILTER (WHERE d."statut" = 'VALIDE')                AS tickets,
                   SUM(d."totalTtcCentimes") FILTER (WHERE d."statut" = 'VALIDE') AS ca,
                   COUNT(*) FILTER (WHERE d."statut" = 'ANNULE')                AS annulations,
                   (SELECT SUM(l."remiseCentimes") FROM "LigneVente" l
                     WHERE l."documentId" IN (
                       SELECT "id" FROM "DocumentVente"
                        WHERE "utilisateurId" = ${utilisateurId}
                          AND "dateVente" >= ${params.debut} AND "dateVente" < ${params.fin}
                     ))                                                         AS remises,
                   (SELECT COUNT(*) FROM "LigneVente" l
                     WHERE l."remiseCentimes" > 0 AND l."documentId" IN (
                       SELECT "id" FROM "DocumentVente"
                        WHERE "utilisateurId" = ${utilisateurId}
                          AND "dateVente" >= ${params.debut} AND "dateVente" < ${params.fin}
                     ))                                                         AS lignes_remisees
              FROM "DocumentVente" d
             WHERE d."utilisateurId" = ${utilisateurId}
               AND d."dateVente" >= ${params.debut} AND d."dateVente" < ${params.fin}`
          : Promise.resolve([]),
        this.prisma.pointage.findMany({
          where: { employeId: e.id, date: { gte: params.debut, lt: params.fin } },
          select: { minutesTravaillees: true, minutesRetard: true },
        }),
        this.ecartsDeCaisse(utilisateurId, params.debut, params.fin),
      ]);

      const v = ventes[0];
      const retards = pointages.filter((p) => p.minutesRetard > 0);
      return {
        employeId: e.id,
        matricule: e.matricule,
        nom: `${e.prenom} ${e.nom}`,
        poste: e.poste,
        compteCaisse: e.utilisateur?.code ?? null,
        nombreTickets: Number(v?.tickets ?? 0),
        chiffreAffairesCentimes: c(v?.ca),
        nombreAnnulations: Number(v?.annulations ?? 0),
        remisesAccordeesCentimes: c(v?.remises),
        nombreLignesRemisees: Number(v?.lignes_remisees ?? 0),
        panierMoyenCentimes: Number(v?.tickets ?? 0) > 0
          ? Math.round(c(v?.ca) / Number(v!.tickets)) : 0,
        joursPointes: pointages.length,
        heuresTravaillees: Math.round(
          (pointages.reduce((t, p) => t + p.minutesTravaillees, 0) / 60) * 100,
        ) / 100,
        nombreRetards: retards.length,
        minutesRetardCumulees: retards.reduce((t, p) => t + p.minutesRetard, 0),
        ...ecarts,
      };
    }));

    return {
      periode: { debut: params.debut, fin: params.fin },
      lignes: lignes.sort(
        (a, b) => b.chiffreAffairesCentimes - a.chiffreAffairesCentimes,
      ),
    };
  }

  /** Ecarts de caisse imputables a un utilisateur sur une periode. */
  private async ecartsDeCaisse(utilisateurId: string | null, debut: Date, fin: Date) {
    if (!utilisateurId) {
      return { nombreClotures: 0, ecartCumuleCentimes: 0, manquantsCentimes: 0 };
    }
    const clotures = await this.prisma.$queryRaw<Array<{
      clotures: bigint; cumule: bigint | null; manquants: bigint | null;
    }>>`
      SELECT COUNT(*)                                            AS clotures,
             SUM(z."ecartCentimes")                              AS cumule,
             -SUM(z."ecartCentimes") FILTER (WHERE z."ecartCentimes" < 0) AS manquants
        FROM "ClotureZ" z
        JOIN "SessionCaisse" s ON s."id" = z."sessionId"
       WHERE COALESCE(s."utilisateurClotureId", s."utilisateurOuvertureId")
             = ${utilisateurId}
         AND z."clotureeLe" >= ${debut} AND z."clotureeLe" < ${fin}`;
    const l = clotures[0];
    return {
      nombreClotures: Number(l?.clotures ?? 0),
      ecartCumuleCentimes: c(l?.cumule),
      manquantsCentimes: c(l?.manquants),
    };
  }

  private async chargerBareme(
    magasinId: string | null,
    heuresParSemaine: number,
  ): Promise<BaremePaie> {
    const bareme = await this.personnel.bareme(magasinId);
    // Les heures du contrat l'emportent sur celles du bareme : c'est ce
    // qui distingue un temps partiel d'un temps plein.
    return { ...bareme, heuresParSemaine };
  }

  private async primesDuContrat(employeId: string): Promise<Prime[] | null> {
    const contrat = await this.prisma.contrat.findFirst({
      where: { employeId, actif: true },
      orderBy: { debut: 'desc' },
      select: { primesFixes: true },
    });
    return (contrat?.primesFixes as unknown as Prime[] | null) ?? null;
  }

  /**
   * Jours ouvrables du mois.
   *
   * Vendredi et samedi sont les jours de repos usuels en Algerie : un
   * calcul au prorata qui compterait le week-end europeen retiendrait
   * trop ou trop peu sur une absence.
   */
  private joursOuvrables(annee: number, mois: number): number {
    const dernier = new Date(annee, mois, 0).getDate();
    let jours = 0;
    for (let jour = 1; jour <= dernier; jour++) {
      const semaine = new Date(annee, mois - 1, jour).getDay();
      if (semaine !== 5 && semaine !== 6) jours++;
    }
    return jours;
  }

  private bulletinEnSortie(bulletin: Record<string, any>, employe: Record<string, any>) {
    return {
      ...bulletin,
      employe,
      salaireBaseCentimes: c(bulletin.salaireBaseCentimes),
      heuresSupCentimes: c(bulletin.heuresSupCentimes),
      primesCentimes: c(bulletin.primesCentimes),
      retenuesCentimes: c(bulletin.retenuesCentimes),
      brutCentimes: c(bulletin.brutCentimes),
      cotisationsCentimes: c(bulletin.cotisationsCentimes),
      irgCentimes: c(bulletin.irgCentimes),
      netAPayerCentimes: c(bulletin.netAPayerCentimes),
      netEnLettres: formaterDA(c(bulletin.netAPayerCentimes), { devise: true }),
    };
  }
}
