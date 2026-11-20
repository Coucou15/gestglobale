import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ModePaiement, Prisma, StatutDocumentVente, StatutSession, TypeMouvementCaisse,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { b, c } from '../commun/bigint';
import {
  calculerCloture, numeroDocument, type ClotureSync, type LigneComptage,
  type ReglementTheorique,
} from '@gestglobale/shared';

@Injectable()
export class CaisseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Ouverture d'une session avec fond de caisse.
   *
   * La cloture est bloquante : tant que la session precedente n'est pas
   * cloturee, aucune nouvelle ouverture n'est acceptee (M4). C'est ce qui
   * empeche la derive constatee dans l'ancien logiciel, ou les recettes
   * physiques n'etaient jamais saisies.
   */
  async ouvrirSession(params: {
    caisseId: string;
    fondDeCaisseCentimes: number;
    utilisateurId: string;
    numeroPropose?: string;
  }) {
    const caisse = await this.prisma.caisse.findUnique({
      where: { id: params.caisseId },
      include: { magasin: { select: { code: true } } },
    });
    if (!caisse) throw new NotFoundException('Caisse introuvable');

    const ouverte = await this.prisma.sessionCaisse.findFirst({
      where: { caisseId: params.caisseId, statut: StatutSession.OUVERTE },
    });
    if (ouverte) {
      throw new ConflictException(
        `La session ${ouverte.numero} est encore ouverte : cloturez-la avant d'en ouvrir une autre`,
      );
    }

    const numero =
      params.numeroPropose ??
      (await this.numeroSessionSuivant(caisse.magasin.code, caisse.numero));

    const session = await this.prisma.sessionCaisse.create({
      data: {
        numero,
        caisseId: params.caisseId,
        fondDeCaisseCentimes: b(params.fondDeCaisseCentimes),
        utilisateurOuvertureId: params.utilisateurId,
      },
    });

    await this.audit.journaliser({
      utilisateurId: params.utilisateurId,
      action: 'caisse.session_ouverte',
      entite: 'SessionCaisse',
      entiteId: session.id,
      caisseId: params.caisseId,
      magasinId: caisse.magasinId,
      details: { numero, fondDeCaisseCentimes: params.fondDeCaisseCentimes },
    });
    return session;
  }

  private async numeroSessionSuivant(codeMagasin: string, numeroCaisse: number): Promise<string> {
    const [ligne] = await this.prisma.$queryRaw<Array<{ valeur: number }>>`
      INSERT INTO "Compteur" ("cle", "valeur", "modifieLe")
      VALUES (${`SESSION.${codeMagasin}.${numeroCaisse}`}, 1, NOW())
      ON CONFLICT ("cle") DO UPDATE
        SET "valeur" = "Compteur"."valeur" + 1, "modifieLe" = NOW()
      RETURNING "valeur"`;
    return `Z-${numeroDocument({ codeMagasin, numeroCaisse, compteur: ligne.valeur, longueurCompteur: 5 })}`;
  }

  /**
   * Totaux theoriques de la session : ce que la caisse devrait contenir,
   * calcule depuis les tickets reellement enregistres, jamais saisi.
   */
  async totauxSession(sessionId: string) {
    const session = await this.prisma.sessionCaisse.findUnique({
      where: { id: sessionId },
      include: { caisse: { include: { magasin: { select: { code: true, nom: true } } } } },
    });
    if (!session) throw new NotFoundException('Session introuvable');

    const [parMode, documents, annulations, remises, mouvements] = await Promise.all([
      this.prisma.reglement.groupBy({
        by: ['mode'],
        where: { document: { sessionId, statut: StatutDocumentVente.VALIDE } },
        _sum: { montantCentimes: true },
      }),
      this.prisma.documentVente.count({
        where: { sessionId, statut: StatutDocumentVente.VALIDE },
      }),
      this.prisma.documentVente.count({
        where: { sessionId, statut: StatutDocumentVente.ANNULE },
      }),
      this.prisma.documentVente.aggregate({
        where: { sessionId, statut: StatutDocumentVente.VALIDE },
        _sum: { totalRemiseCentimes: true, remisePiedCentimes: true },
      }),
      this.prisma.mouvementCaisse.findMany({ where: { sessionId } }),
    ]);

    const entrees = mouvements
      .filter((m) => m.type === TypeMouvementCaisse.ENTREE_TIROIR)
      .reduce((t, m) => t + c(m.montantCentimes), 0);
    const sorties = mouvements
      .filter((m) => m.type === TypeMouvementCaisse.SORTIE_TIROIR)
      .reduce((t, m) => t + c(m.montantCentimes), 0);
    const prelevements = mouvements
      .filter((m) => m.type === TypeMouvementCaisse.PRELEVEMENT_COFFRE)
      .reduce((t, m) => t + c(m.montantCentimes), 0);

    const theoriques: ReglementTheorique[] = parMode.map((p) => ({
      mode: p.mode as ReglementTheorique['mode'],
      montantCentimes: c(p._sum.montantCentimes),
    }));

    return {
      session,
      theoriques,
      nombreTickets: documents,
      nombreAnnulations: annulations,
      totalRemisesCentimes:
        c(remises._sum.totalRemiseCentimes) + c(remises._sum.remisePiedCentimes),
      entreesEspecesCentimes: entrees,
      sortiesEspecesCentimes: sorties,
      preleveeVersCoffreCentimes: prelevements,
      fondDeCaisseCentimes: c(session.fondDeCaisseCentimes),
    };
  }

  /**
   * Previsualisation de la cloture : le caissier saisit son comptage et voit
   * l'ecart avant de valider. Aucune ecriture n'a lieu ici.
   */
  async previsualiserCloture(sessionId: string, comptage: LigneComptage[]) {
    const totaux = await this.totauxSession(sessionId);
    const resultat = calculerCloture({
      fondDeCaisseCentimes: totaux.fondDeCaisseCentimes,
      theoriques: totaux.theoriques,
      comptageEspeces: comptage,
      entreesEspecesCentimes: totaux.entreesEspecesCentimes,
      sortiesEspecesCentimes: totaux.sortiesEspecesCentimes,
      preleveeVersCoffreCentimes: totaux.preleveeVersCoffreCentimes,
    });
    return { ...resultat, nombreTickets: totaux.nombreTickets };
  }

  /**
   * Cloture Z definitive.
   *
   * Le comptage par coupure est obligatoire et l'ecart doit etre justifie
   * des qu'il n'est pas nul : c'est la correction directe du defaut releve
   * dans l'export (recette physique a 0, ecarts de -72 171 et -96 637 DA).
   */
  async cloturer(params: {
    sessionId: string;
    comptage: LigneComptage[];
    justification?: string;
    utilisateurId: string;
    numeroPropose?: string;
    horsLigne?: boolean;
  }) {
    const session = await this.prisma.sessionCaisse.findUnique({
      where: { id: params.sessionId },
      include: { caisse: { include: { magasin: { select: { code: true } } } } },
    });
    if (!session) throw new NotFoundException('Session introuvable');
    if (session.statut === StatutSession.CLOTUREE) {
      throw new ConflictException('Session deja cloturee');
    }
    if (params.comptage.length === 0) {
      throw new BadRequestException(
        'Le comptage des especes par coupure est obligatoire pour cloturer',
      );
    }

    const totaux = await this.totauxSession(params.sessionId);
    const resultat = calculerCloture({
      fondDeCaisseCentimes: totaux.fondDeCaisseCentimes,
      theoriques: totaux.theoriques,
      comptageEspeces: params.comptage,
      entreesEspecesCentimes: totaux.entreesEspecesCentimes,
      sortiesEspecesCentimes: totaux.sortiesEspecesCentimes,
      preleveeVersCoffreCentimes: totaux.preleveeVersCoffreCentimes,
    });

    if (resultat.justificationRequise && !params.justification?.trim()) {
      throw new BadRequestException(
        `Ecart de ${resultat.ecartEspecesCentimes / 100} DA : une justification est obligatoire`,
      );
    }

    const numero = params.numeroPropose ?? `${session.numero}-Z`;

    const cloture = await this.prisma.$transaction(async (tx) => {
      const creee = await tx.clotureZ.create({
        data: {
          numero,
          sessionId: params.sessionId,
          theoriqueEspecesCentimes: b(resultat.theoriqueEspecesCentimes),
          compteEspecesCentimes: b(resultat.compteEspecesCentimes),
          ecartCentimes: b(resultat.ecartEspecesCentimes),
          justification: params.justification ?? null,
          comptage: params.comptage as unknown as Prisma.InputJsonValue,
          totauxParMode: resultat.totauxParMode as unknown as Prisma.InputJsonValue,
          nombreTickets: totaux.nombreTickets,
          nombreAnnulations: totaux.nombreAnnulations,
          totalRemisesCentimes: b(totaux.totalRemisesCentimes),
          horsLigne: params.horsLigne ?? false,
        },
      });

      await tx.sessionCaisse.update({
        where: { id: params.sessionId },
        data: {
          statut: StatutSession.CLOTUREE,
          clotureeLe: new Date(),
          utilisateurClotureId: params.utilisateurId,
        },
      });
      return creee;
    });

    await this.audit.journaliser({
      utilisateurId: params.utilisateurId,
      action: 'caisse.cloture_z',
      entite: 'ClotureZ',
      entiteId: cloture.id,
      caisseId: session.caisseId,
      details: {
        numero,
        ecartCentimes: resultat.ecartEspecesCentimes,
        recetteTotaleCentimes: resultat.recetteTotaleCentimes,
        justification: params.justification ?? null,
      },
    });

    return { cloture, resultat };
  }

  /** Enregistre une cloture etablie hors ligne et remontee ensuite. */
  async enregistrerClotureRemontee(
    cloture: ClotureSync,
  ): Promise<{ statut: 'ACCEPTE' | 'DEJA_RECU' | 'REFUSE'; numero: string; erreur?: string }> {
    const existante = await this.prisma.clotureZ.findUnique({
      where: { numero: cloture.numero },
      select: { id: true },
    });
    if (existante) return { statut: 'DEJA_RECU', numero: cloture.numero };

    const session = await this.prisma.sessionCaisse.findUnique({
      where: { numero: cloture.sessionCaisseNumero },
    });
    if (!session) {
      return {
        statut: 'REFUSE',
        numero: cloture.numero,
        erreur: `Session inconnue : ${cloture.sessionCaisseNumero}`,
      };
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.clotureZ.create({
          data: {
            numero: cloture.numero,
            sessionId: session.id,
            theoriqueEspecesCentimes: b(cloture.theoriqueEspecesCentimes),
            compteEspecesCentimes: b(cloture.compteEspecesCentimes),
            ecartCentimes: b(cloture.ecartCentimes),
            justification: cloture.justification,
            comptage: cloture.comptage as unknown as Prisma.InputJsonValue,
            totauxParMode: cloture.totauxParMode as unknown as Prisma.InputJsonValue,
            nombreTickets: cloture.nombreTickets,
            horsLigne: true,
            clotureeLe: new Date(cloture.clotureLe),
          },
        });
        await tx.sessionCaisse.update({
          where: { id: session.id },
          data: {
            statut: StatutSession.CLOTUREE,
            clotureeLe: new Date(cloture.clotureLe),
            utilisateurClotureId: cloture.utilisateurClotureId,
            horsLigne: true,
          },
        });
      });
      return { statut: 'ACCEPTE', numero: cloture.numero };
    } catch (erreur) {
      if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === 'P2002') {
        return { statut: 'DEJA_RECU', numero: cloture.numero };
      }
      return {
        statut: 'REFUSE',
        numero: cloture.numero,
        erreur: erreur instanceof Error ? erreur.message : String(erreur),
      };
    }
  }

  /** Mouvement d'especes du tiroir hors vente (achat comptant, depense). */
  async mouvementCaisse(params: {
    sessionId: string;
    type: TypeMouvementCaisse;
    montantCentimes: number;
    motif: string;
    utilisateurId: string;
    reference?: string;
  }) {
    const session = await this.prisma.sessionCaisse.findUnique({ where: { id: params.sessionId } });
    if (!session) throw new NotFoundException('Session introuvable');
    if (session.statut === StatutSession.CLOTUREE) {
      throw new BadRequestException('Session deja cloturee');
    }
    const reference = params.reference ?? `MVC-${Date.now()}-${session.numero}`;

    return this.prisma.mouvementCaisse.create({
      data: {
        reference,
        sessionId: params.sessionId,
        type: params.type,
        montantCentimes: b(params.montantCentimes),
        motif: params.motif,
        utilisateurId: params.utilisateurId,
      },
    });
  }

  /**
   * Ecarts de caisse par caissier sur une periode (M9).
   * C'est le rapport que le gerant consulte pour arbitrer les retenues.
   */
  async ecartsParCaissier(magasinIds: string[], jours = 30) {
    const depuis = new Date();
    depuis.setDate(depuis.getDate() - jours);

    const clotures = await this.prisma.clotureZ.findMany({
      where: {
        clotureeLe: { gte: depuis },
        session: { caisse: { magasinId: { in: magasinIds } } },
      },
      include: {
        session: {
          include: {
            utilisateurCloture: { select: { id: true, code: true, nom: true } },
            caisse: { select: { numero: true, libelle: true } },
          },
        },
      },
      orderBy: { clotureeLe: 'desc' },
    });

    const parCaissier = new Map<
      string,
      { nom: string; code: string; nombre: number; totalEcart: number; pireEcart: number }
    >();

    for (const cloture of clotures) {
      const utilisateur = cloture.session.utilisateurCloture;
      if (!utilisateur) continue;
      const ecart = c(cloture.ecartCentimes);
      const courant = parCaissier.get(utilisateur.id) ?? {
        nom: utilisateur.nom,
        code: utilisateur.code,
        nombre: 0,
        totalEcart: 0,
        pireEcart: 0,
      };
      courant.nombre += 1;
      courant.totalEcart += ecart;
      if (Math.abs(ecart) > Math.abs(courant.pireEcart)) courant.pireEcart = ecart;
      parCaissier.set(utilisateur.id, courant);
    }

    return {
      periodeJours: jours,
      clotures: clotures.map((cl) => ({
        numero: cl.numero,
        date: cl.clotureeLe,
        caisse: cl.session.caisse,
        caissier: cl.session.utilisateurCloture,
        theoriqueCentimes: c(cl.theoriqueEspecesCentimes),
        compteCentimes: c(cl.compteEspecesCentimes),
        ecartCentimes: c(cl.ecartCentimes),
        justification: cl.justification,
        horsLigne: cl.horsLigne,
      })),
      parCaissier: [...parCaissier.entries()].map(([id, v]) => ({
        utilisateurId: id,
        ...v,
        ecartMoyenCentimes: v.nombre > 0 ? Math.round(v.totalEcart / v.nombre) : 0,
      })),
    };
  }
}
