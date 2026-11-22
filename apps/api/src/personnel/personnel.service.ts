import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CategorieOperation, Prisma, SensOperation, StatutAbsence, TypeAbsence, TypeContrat,
} from '@prisma/client';
import {
  BAREME_PAIE_DEFAUT, calculerBulletin, contratsAAlerter,
  type BaremePaie, type Prime, type Retenue,
} from '@gestglobale/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TresorerieService } from '../tresorerie/tresorerie.service';
import { NumerotationService } from '../commun/numerotation.service';
import { AuditService } from '../audit/audit.service';
import { b, c } from '../commun/bigint';

/**
 * Gestion du personnel (M13).
 *
 * Deux principes gouvernent ce module.
 *
 * **Un depart coupe les acces.** La section 6 l'exige, et c'est la
 * premiere faille d'un commerce : un caissier parti dont le code PIN
 * ouvre encore la caisse. Sortir un employe desactive son compte dans
 * la meme transaction, sans geste supplementaire a ne pas oublier.
 *
 * **Les taux de paie ne sont pas dans le code.** Cotisations et impot
 * suivent un bareme parametrable, conserve sur chaque bulletin : un
 * bulletin de l'an dernier doit pouvoir etre justifie avec les taux de
 * l'an dernier. Les valeurs par defaut sont plausibles mais doivent
 * etre validees par le comptable du client avant la premiere paie.
 */
@Injectable()
export class PersonnelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tresorerie: TresorerieService,
    private readonly numerotation: NumerotationService,
    private readonly audit: AuditService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Bareme                                                           */
  /* ---------------------------------------------------------------- */

  async bareme(magasinId?: string | null): Promise<BaremePaie> {
    const parametre =
      (magasinId
        ? await this.prisma.parametre.findFirst({ where: { cle: 'paie.bareme', magasinId } })
        : null)
      ?? (await this.prisma.parametre.findFirst({
        where: { cle: 'paie.bareme', magasinId: null },
      }));
    if (!parametre) return BAREME_PAIE_DEFAUT;
    return { ...BAREME_PAIE_DEFAUT, ...(parametre.valeur as object) } as BaremePaie;
  }

  /* ---------------------------------------------------------------- */
  /* Dossiers et contrats                                             */
  /* ---------------------------------------------------------------- */

  async employes(params: { magasinIds: string[]; inactifs?: boolean; texte?: string }) {
    const employes = await this.prisma.employe.findMany({
      where: {
        OR: [{ magasinId: { in: params.magasinIds } }, { magasinId: null }],
        ...(params.inactifs ? {} : { actif: true }),
        ...(params.texte
          ? {
            OR: [
              { nom: { contains: params.texte, mode: 'insensitive' } },
              { prenom: { contains: params.texte, mode: 'insensitive' } },
              { matricule: { contains: params.texte, mode: 'insensitive' } },
            ],
          }
          : {}),
      },
      orderBy: [{ actif: 'desc' }, { nom: 'asc' }, { prenom: 'asc' }],
      include: {
        magasin: { select: { code: true, nom: true } },
        utilisateur: { select: { id: true, code: true, login: true, role: true, actif: true } },
        contrats: { orderBy: { debut: 'desc' }, take: 1 },
      },
    });
    return employes.map((e) => this.enSortie(e));
  }

  async employe(id: string, magasinIds: string[]) {
    const employe = await this.prisma.employe.findUnique({
      where: { id },
      include: {
        magasin: { select: { code: true, nom: true } },
        utilisateur: { select: { id: true, code: true, login: true, role: true, actif: true } },
        contrats: { orderBy: { debut: 'desc' } },
        absences: { orderBy: { debut: 'desc' }, take: 50 },
        avances: { orderBy: { date: 'desc' }, take: 50 },
        bulletins: {
          orderBy: [{ periodeAnnee: 'desc' }, { periodeMois: 'desc' }],
          take: 24,
        },
      },
    });
    if (!employe) throw new NotFoundException('Employe introuvable');
    if (employe.magasinId && !magasinIds.includes(employe.magasinId)) {
      throw new NotFoundException('Employe introuvable');
    }
    return this.enSortie(employe);
  }

  async creerEmploye(params: {
    donnees: Record<string, unknown>;
    magasinIds: string[];
    utilisateurId: string;
  }) {
    const magasinId = (params.donnees.magasinId as string | undefined) ?? params.magasinIds[0];
    if (magasinId && !params.magasinIds.includes(magasinId)) {
      throw new BadRequestException('Ce magasin ne fait pas partie des votres');
    }
    const matricule = (params.donnees.matricule as string | undefined)?.trim()
      || await this.numerotation.suivant('EMP');

    const employe = await this.prisma.employe.create({
      data: {
        matricule,
        nom: String(params.donnees.nom ?? '').trim(),
        prenom: String(params.donnees.prenom ?? '').trim(),
        nin: (params.donnees.nin as string) || null,
        numeroSecuriteSociale: (params.donnees.numeroSecuriteSociale as string) || null,
        dateNaissance: params.donnees.dateNaissance
          ? new Date(params.donnees.dateNaissance as string) : null,
        adresse: (params.donnees.adresse as string) || null,
        telephone: (params.donnees.telephone as string) || null,
        situationFamiliale: (params.donnees.situationFamiliale as string) || null,
        nombreEnfants: Number(params.donnees.nombreEnfants ?? 0),
        poste: (params.donnees.poste as string) || null,
        magasinId,
        dateEmbauche: params.donnees.dateEmbauche
          ? new Date(params.donnees.dateEmbauche as string) : new Date(),
        soldeCongesJours: Number(params.donnees.soldeCongesJours ?? 0),
      },
      include: {
        magasin: { select: { code: true, nom: true } },
        utilisateur: { select: { id: true, code: true, login: true, role: true, actif: true } },
        contrats: true,
      },
    });

    await this.audit.journaliser({
      utilisateurId: params.utilisateurId,
      action: 'personnel.employe_cree',
      entite: 'Employe',
      entiteId: employe.id,
      details: { matricule, nom: employe.nom, prenom: employe.prenom },
    });
    return this.enSortie(employe);
  }

  async modifierEmploye(id: string, donnees: Record<string, unknown>, utilisateurId: string) {
    const champs = [
      'nom', 'prenom', 'nin', 'numeroSecuriteSociale', 'adresse', 'telephone',
      'situationFamiliale', 'poste',
    ];
    const data: Record<string, unknown> = {};
    for (const champ of champs) {
      if (champ in donnees) data[champ] = donnees[champ] || null;
    }
    if ('nombreEnfants' in donnees) data.nombreEnfants = Number(donnees.nombreEnfants);
    if ('soldeCongesJours' in donnees) data.soldeCongesJours = Number(donnees.soldeCongesJours);
    if ('dateNaissance' in donnees) {
      data.dateNaissance = donnees.dateNaissance
        ? new Date(donnees.dateNaissance as string) : null;
    }

    const employe = await this.prisma.employe.update({
      where: { id },
      data,
      include: {
        magasin: { select: { code: true, nom: true } },
        utilisateur: { select: { id: true, code: true, login: true, role: true, actif: true } },
        contrats: { orderBy: { debut: 'desc' } },
      },
    });
    await this.audit.journaliser({
      utilisateurId,
      action: 'personnel.employe_modifie',
      entite: 'Employe',
      entiteId: id,
      details: { champs: Object.keys(data) },
    });
    return this.enSortie(employe);
  }

  /**
   * Sortie d'un employe : le dossier reste, les acces tombent.
   *
   * C'est la faille classique d'un commerce — un caissier parti dont le
   * code PIN ouvre encore la caisse. Les deux gestes tiennent dans une
   * seule transaction : il n'y a rien a ne pas oublier.
   */
  async sortir(params: {
    id: string; dateSortie: string; motif: string; utilisateurId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const employe = await tx.employe.findUnique({
        where: { id: params.id },
        include: { utilisateur: { select: { id: true, login: true } } },
      });
      if (!employe) throw new NotFoundException('Employe introuvable');
      if (!employe.actif) throw new BadRequestException('Cet employe est deja sorti');

      const maj = await tx.employe.update({
        where: { id: params.id },
        data: { actif: false, dateSortie: new Date(params.dateSortie) },
      });

      // Les contrats en cours se ferment avec le depart.
      await tx.contrat.updateMany({
        where: { employeId: params.id, actif: true },
        data: { actif: false },
      });

      let compteDesactive: string | null = null;
      if (employe.utilisateur) {
        await tx.utilisateur.update({
          where: { id: employe.utilisateur.id },
          data: { actif: false },
        });
        // Les jetons en cours sont revoques : desactiver le compte sans
        // couper les sessions laisserait la porte ouverte jusqu'a
        // l'expiration du dernier jeton.
        await tx.jetonRafraichissement.deleteMany({
          where: { utilisateurId: employe.utilisateur.id },
        });
        compteDesactive = employe.utilisateur.login;
      }

      await this.audit.journaliser({
        utilisateurId: params.utilisateurId,
        action: 'personnel.sortie',
        entite: 'Employe',
        entiteId: params.id,
        details: {
          matricule: employe.matricule,
          dateSortie: params.dateSortie,
          motif: params.motif,
          compteDesactive,
        },
      });

      return { ...maj, compteDesactive };
    });
  }

  /** Rattache un employe a un compte utilisateur, ou l'en detache. */
  async rattacherCompte(employeId: string, utilisateurCompteId: string | null, parId: string) {
    const employe = await this.prisma.employe.findUnique({
      where: { id: employeId },
      include: { utilisateur: { select: { id: true } } },
    });
    if (!employe) throw new NotFoundException('Employe introuvable');

    if (utilisateurCompteId) {
      const deja = await this.prisma.employe.findFirst({
        where: { utilisateur: { id: utilisateurCompteId }, id: { not: employeId } },
        select: { matricule: true, nom: true, prenom: true },
      });
      if (deja) {
        throw new BadRequestException(
          `Ce compte est deja rattache a ${deja.prenom} ${deja.nom} (${deja.matricule})`,
        );
      }
    }

    // Le lien vit cote Utilisateur : on detache d'abord l'ancien.
    if (employe.utilisateur) {
      await this.prisma.utilisateur.update({
        where: { id: employe.utilisateur.id },
        data: { employeId: null },
      });
    }
    if (utilisateurCompteId) {
      await this.prisma.utilisateur.update({
        where: { id: utilisateurCompteId },
        data: { employeId },
      });
    }

    await this.audit.journaliser({
      utilisateurId: parId,
      action: 'personnel.compte_rattache',
      entite: 'Employe',
      entiteId: employeId,
      details: { utilisateurId: utilisateurCompteId },
    });
    return this.employe(employeId, [employe.magasinId ?? '']);
  }

  async ajouterContrat(params: {
    employeId: string;
    type: TypeContrat;
    debut: string;
    fin?: string;
    salaireBaseCentimes: number;
    heuresParSemaine?: number;
    primesFixes?: Prime[];
    utilisateurId: string;
  }) {
    if (params.salaireBaseCentimes <= 0) {
      throw new BadRequestException('Le salaire de base doit etre positif');
    }
    const aUnTerme = params.type === TypeContrat.CDD || params.type === TypeContrat.ESSAI;
    if (aUnTerme && !params.fin) {
      throw new BadRequestException(
        'Un CDD et une periode d’essai ont un terme : indiquez la date de fin',
      );
    }
    if (params.fin && new Date(params.fin) <= new Date(params.debut)) {
      throw new BadRequestException('La fin du contrat doit suivre son debut');
    }

    return this.prisma.$transaction(async (tx) => {
      // Un seul contrat actif a la fois : le precedent se ferme.
      await tx.contrat.updateMany({
        where: { employeId: params.employeId, actif: true },
        data: { actif: false },
      });

      const contrat = await tx.contrat.create({
        data: {
          employeId: params.employeId,
          type: params.type,
          debut: new Date(params.debut),
          fin: params.fin ? new Date(params.fin) : null,
          salaireBaseCentimes: b(params.salaireBaseCentimes),
          heuresParSemaine: params.heuresParSemaine ?? 40,
          primesFixes: (params.primesFixes ?? []) as unknown as Prisma.InputJsonValue,
        },
      });

      await this.audit.journaliser({
        utilisateurId: params.utilisateurId,
        action: 'personnel.contrat_ajoute',
        entite: 'Contrat',
        entiteId: contrat.id,
        details: {
          employeId: params.employeId,
          type: params.type,
          salaireBaseCentimes: params.salaireBaseCentimes,
        },
      });
      return { ...contrat, salaireBaseCentimes: c(contrat.salaireBaseCentimes) };
    });
  }

  /**
   * Contrats qui arrivent a terme dans les trente jours (M13).
   *
   * Les contrats deja expires y figurent aussi, avec un nombre de jours
   * negatif : un CDD qu'on a laisse courir sans decision est le cas le
   * plus urgent, pas celui qu'il faut cacher.
   */
  async alertesContrats(magasinIds: string[], jours = 30) {
    const contrats = await this.prisma.contrat.findMany({
      where: {
        actif: true,
        fin: { not: null },
        employe: {
          actif: true,
          OR: [{ magasinId: { in: magasinIds } }, { magasinId: null }],
        },
      },
      include: {
        employe: {
          select: { id: true, matricule: true, nom: true, prenom: true, poste: true },
        },
      },
    });

    return contratsAAlerter(
      contrats.map((ct) => ({ ...ct, salaireBaseCentimes: c(ct.salaireBaseCentimes) })),
      new Date(),
      jours,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Pointage                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Pointe une entree ou une sortie.
   *
   * Idempotent par employe et par jour : un second pointage d'entree ne
   * remplace pas le premier — l'heure d'arrivee est un fait, pas une
   * valeur qu'on corrige en repointant. Une sortie, elle, se met a jour :
   * on sort parfois deux fois dans la journee, et c'est la derniere qui
   * compte.
   */
  async pointer(params: {
    employeId: string;
    sens: 'ENTREE' | 'SORTIE';
    instant?: string;
    source?: string;
    horsLigne?: boolean;
    reference?: string;
  }) {
    const instant = params.instant ? new Date(params.instant) : new Date();
    const jour = new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());

    const employe = await this.prisma.employe.findUnique({
      where: { id: params.employeId },
      select: { id: true, actif: true, nom: true, prenom: true },
    });
    if (!employe) throw new NotFoundException('Employe introuvable');
    if (!employe.actif) {
      throw new BadRequestException(
        `${employe.prenom} ${employe.nom} ne fait plus partie du personnel`,
      );
    }

    const existant = await this.prisma.pointage.findUnique({
      where: { employeId_date: { employeId: params.employeId, date: jour } },
    });

    if (params.sens === 'ENTREE') {
      if (existant?.entree) {
        // Deja pointe : on rend le pointage tel quel plutot que d'ecraser
        // l'heure d'arrivee. Une remontee hors ligne rejouee ne doit pas
        // reecrire l'histoire.
        return this.pointageEnSortie(existant);
      }
      const reference = params.reference
        ?? await this.numerotation.suivant('PTG');
      const pointage = existant
        ? await this.prisma.pointage.update({
          where: { id: existant.id },
          data: { entree: instant, source: params.source, horsLigne: params.horsLigne ?? false },
        })
        : await this.prisma.pointage.create({
          data: {
            reference,
            employeId: params.employeId,
            date: jour,
            entree: instant,
            source: params.source,
            horsLigne: params.horsLigne ?? false,
          },
        });
      return this.pointageEnSortie(pointage);
    }

    if (!existant?.entree) {
      throw new BadRequestException(
        'Aucune entree pointee ce jour : on ne sort pas sans etre entre',
      );
    }
    const minutes = Math.max(
      0,
      Math.round((instant.getTime() - existant.entree.getTime()) / 60000),
    );
    const pointage = await this.prisma.pointage.update({
      where: { id: existant.id },
      data: {
        sortie: instant,
        minutesTravaillees: minutes,
        horsLigne: existant.horsLigne || (params.horsLigne ?? false),
      },
    });
    return this.pointageEnSortie(pointage);
  }

  async pointages(params: {
    magasinIds: string[]; debut: Date; fin: Date; employeId?: string;
  }) {
    const pointages = await this.prisma.pointage.findMany({
      where: {
        date: { gte: params.debut, lt: params.fin },
        ...(params.employeId ? { employeId: params.employeId } : {}),
        employe: { OR: [{ magasinId: { in: params.magasinIds } }, { magasinId: null }] },
      },
      orderBy: [{ date: 'desc' }, { employeId: 'asc' }],
      include: {
        employe: { select: { matricule: true, nom: true, prenom: true } },
      },
    });
    return pointages.map((p) => this.pointageEnSortie(p));
  }

  private pointageEnSortie(p: Record<string, any>) {
    return {
      ...p,
      heuresTravaillees: Math.round((p.minutesTravaillees / 60) * 100) / 100,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Plannings                                                        */
  /* ---------------------------------------------------------------- */

  async planning(params: { magasinId: string; debut: Date; fin: Date }) {
    const creneaux = await this.prisma.planning.findMany({
      where: { magasinId: params.magasinId, date: { gte: params.debut, lt: params.fin } },
      orderBy: [{ date: 'asc' }, { heureDebut: 'asc' }],
      include: {
        employe: { select: { id: true, matricule: true, nom: true, prenom: true } },
      },
    });

    // Couverture : les heures reellement couvertes chaque jour. Un
    // planning sans trou est le seul moyen de tenir les horaires
    // d'ouverture, et un trou doit sauter aux yeux.
    const parJour = new Map<string, { debut: string; fin: string }[]>();
    for (const creneau of creneaux) {
      const clef = creneau.date.toISOString().slice(0, 10);
      const liste = parJour.get(clef) ?? [];
      liste.push({ debut: creneau.heureDebut, fin: creneau.heureFin });
      parJour.set(clef, liste);
    }

    return {
      creneaux,
      couverture: [...parJour.entries()].map(([jour, plages]) => {
        const triees = [...plages].sort((a, b) => a.debut.localeCompare(b.debut));
        const trous: Array<{ de: string; a: string }> = [];
        for (let i = 1; i < triees.length; i++) {
          if (triees[i].debut > triees[i - 1].fin) {
            trous.push({ de: triees[i - 1].fin, a: triees[i].debut });
          }
        }
        return {
          jour,
          nombreCreneaux: plages.length,
          premiereHeure: triees[0]?.debut ?? null,
          derniereHeure: triees.reduce(
            (max, p) => (p.fin > max ? p.fin : max), triees[0]?.fin ?? '',
          ),
          trous,
        };
      }),
    };
  }

  async planifier(params: {
    magasinId: string; employeId: string; date: string;
    heureDebut: string; heureFin: string; poste?: string; utilisateurId: string;
  }) {
    if (params.heureFin <= params.heureDebut) {
      throw new BadRequestException('La fin du poste doit suivre son debut');
    }
    const creneau = await this.prisma.planning.create({
      data: {
        magasinId: params.magasinId,
        employeId: params.employeId,
        date: new Date(params.date),
        heureDebut: params.heureDebut,
        heureFin: params.heureFin,
        poste: params.poste,
      },
      include: { employe: { select: { matricule: true, nom: true, prenom: true } } },
    });
    await this.audit.journaliser({
      utilisateurId: params.utilisateurId,
      action: 'personnel.planning_cree',
      entite: 'Planning',
      entiteId: creneau.id,
      details: { employeId: params.employeId, date: params.date },
    });
    return creneau;
  }

  /** Echange de poste : il n'est effectif qu'une fois valide (M13). */
  async echangerPoste(params: {
    planningId: string; avecEmployeId: string; valide: boolean; utilisateurId: string;
  }) {
    const creneau = await this.prisma.planning.findUnique({ where: { id: params.planningId } });
    if (!creneau) throw new NotFoundException('Creneau introuvable');

    const maj = await this.prisma.planning.update({
      where: { id: params.planningId },
      data: params.valide
        // Valide : l'echange prend effet, le creneau change de titulaire.
        ? {
          employeId: params.avecEmployeId,
          echangeAvecEmployeId: creneau.employeId,
          valideParId: params.utilisateurId,
        }
        // Demande : on note qui demande, sans toucher au titulaire.
        : { echangeAvecEmployeId: params.avecEmployeId, valideParId: null },
      include: { employe: { select: { matricule: true, nom: true, prenom: true } } },
    });

    await this.audit.journaliser({
      utilisateurId: params.utilisateurId,
      action: params.valide ? 'personnel.echange_valide' : 'personnel.echange_demande',
      entite: 'Planning',
      entiteId: params.planningId,
      details: { avecEmployeId: params.avecEmployeId },
    });
    return maj;
  }

  /* ---------------------------------------------------------------- */
  /* Absences et conges                                               */
  /* ---------------------------------------------------------------- */

  async demanderAbsence(params: {
    employeId: string; type: TypeAbsence; debut: string; fin: string;
    motif?: string; utilisateurId: string;
  }) {
    const debut = new Date(params.debut);
    const fin = new Date(params.fin);
    if (fin < debut) {
      throw new BadRequestException('La fin de l’absence doit suivre son debut');
    }
    const nombreJours = Math.floor((fin.getTime() - debut.getTime()) / 86400000) + 1;

    const absence = await this.prisma.absence.create({
      data: {
        employeId: params.employeId,
        type: params.type,
        debut, fin, nombreJours,
        motif: params.motif,
      },
      include: { employe: { select: { matricule: true, nom: true, prenom: true } } },
    });
    await this.audit.journaliser({
      utilisateurId: params.utilisateurId,
      action: 'personnel.absence_demandee',
      entite: 'Absence',
      entiteId: absence.id,
      details: { employeId: params.employeId, type: params.type, nombreJours },
    });
    return absence;
  }

  /**
   * Validation d'une absence.
   *
   * Un conge annuel valide decompte le solde. Le solde peut devenir
   * negatif : le gerant a le droit d'accorder une avance sur conges, et
   * le logiciel doit le montrer plutot que de refuser une decision deja
   * prise.
   */
  async validerAbsence(params: {
    id: string; accepte: boolean; utilisateurId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const absence = await tx.absence.findUnique({
        where: { id: params.id },
        include: { employe: { select: { id: true, soldeCongesJours: true } } },
      });
      if (!absence) throw new NotFoundException('Absence introuvable');
      if (absence.statut !== StatutAbsence.DEMANDEE) {
        throw new BadRequestException(
          `Cette demande est deja ${absence.statut === 'VALIDEE' ? 'validee' : 'refusee'}`,
        );
      }

      const maj = await tx.absence.update({
        where: { id: params.id },
        data: {
          statut: params.accepte ? StatutAbsence.VALIDEE : StatutAbsence.REFUSEE,
          valideParId: params.utilisateurId,
          valideeLe: new Date(),
        },
        include: { employe: { select: { matricule: true, nom: true, prenom: true } } },
      });

      let soldeApres = absence.employe.soldeCongesJours;
      if (params.accepte && absence.type === TypeAbsence.CONGE_ANNUEL) {
        soldeApres = absence.employe.soldeCongesJours - absence.nombreJours;
        await tx.employe.update({
          where: { id: absence.employe.id },
          data: { soldeCongesJours: soldeApres },
        });
      }

      await this.audit.journaliser({
        utilisateurId: params.utilisateurId,
        action: params.accepte ? 'personnel.absence_validee' : 'personnel.absence_refusee',
        entite: 'Absence',
        entiteId: params.id,
        details: { nombreJours: absence.nombreJours, soldeApres },
      });

      return { ...maj, soldeCongesApres: soldeApres };
    });
  }

  async absences(params: {
    magasinIds: string[]; statut?: StatutAbsence; employeId?: string;
  }) {
    return this.prisma.absence.findMany({
      where: {
        ...(params.statut ? { statut: params.statut } : {}),
        ...(params.employeId ? { employeId: params.employeId } : {}),
        employe: { OR: [{ magasinId: { in: params.magasinIds } }, { magasinId: null }] },
      },
      orderBy: [{ statut: 'asc' }, { debut: 'desc' }],
      take: 200,
      include: {
        employe: {
          select: { matricule: true, nom: true, prenom: true, soldeCongesJours: true },
        },
      },
    });
  }

  /* ---------------------------------------------------------------- */
  /* Avances sur salaire                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Avance sur salaire : sortie de tresorerie et dette de l'employe.
   *
   * Les deux ecritures tiennent dans une transaction. Une avance payee
   * du tiroir mais non retenue sur la paie suivante est de l'argent
   * perdu ; l'inverse serait une retenue sans contrepartie.
   */
  async avance(params: {
    employeId: string; compteId: string; montantCentimes: number;
    motif?: string; utilisateurId: string;
  }) {
    if (params.montantCentimes <= 0) {
      throw new BadRequestException('Le montant de l’avance doit etre positif');
    }
    const employe = await this.prisma.employe.findUnique({
      where: { id: params.employeId },
      select: { id: true, actif: true, matricule: true, nom: true, prenom: true },
    });
    if (!employe) throw new NotFoundException('Employe introuvable');
    if (!employe.actif) {
      throw new BadRequestException('Cet employe ne fait plus partie du personnel');
    }

    const numero = await this.numerotation.suivant('AVS');

    return this.prisma.$transaction(async (tx) => {
      await this.tresorerie.enregistrer({
        compteId: params.compteId,
        sens: SensOperation.SORTIE,
        categorie: CategorieOperation.AVANCE_SALAIRE,
        montantCentimes: params.montantCentimes,
        libelle: `Avance sur salaire — ${employe.prenom} ${employe.nom}`,
        employeId: params.employeId,
        documentType: 'AVANCE_SALAIRE',
        documentNumero: numero,
        utilisateurId: params.utilisateurId,
      }, tx);

      const avance = await tx.avanceSalaire.create({
        data: {
          numero,
          employeId: params.employeId,
          montantCentimes: b(params.montantCentimes),
          motif: params.motif,
        },
      });

      await this.audit.journaliser({
        utilisateurId: params.utilisateurId,
        action: 'personnel.avance',
        entite: 'AvanceSalaire',
        entiteId: avance.id,
        details: {
          numero, employeId: params.employeId, montantCentimes: params.montantCentimes,
        },
      });

      return { ...avance, montantCentimes: c(avance.montantCentimes) };
    });
  }

  private enSortie(employe: Record<string, any>) {
    return {
      ...employe,
      contrats: (employe.contrats ?? []).map((ct: any) => ({
        ...ct,
        salaireBaseCentimes: c(ct.salaireBaseCentimes),
      })),
      avances: (employe.avances ?? []).map((a: any) => ({
        ...a,
        montantCentimes: c(a.montantCentimes),
        rembourseCentimes: c(a.rembourseCentimes),
      })),
      bulletins: (employe.bulletins ?? []).map((bu: any) => ({
        ...bu,
        salaireBaseCentimes: c(bu.salaireBaseCentimes),
        brutCentimes: c(bu.brutCentimes),
        netAPayerCentimes: c(bu.netAPayerCentimes),
      })),
    };
  }
}
