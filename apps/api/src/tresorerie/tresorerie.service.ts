import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CategorieOperation, Prisma, SensOperation, StatutTransfert, TypeCompte,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumerotationService } from '../commun/numerotation.service';
import { AuditService } from '../audit/audit.service';
import { b, c } from '../commun/bigint';

export interface DemandeOperation {
  compteId: string;
  sens: SensOperation;
  categorie: CategorieOperation;
  montantCentimes: number;
  libelle: string;
  tiersId?: string | null;
  employeId?: string | null;
  documentType?: string;
  documentNumero?: string;
  transfertId?: string;
  utilisateurId: string;
  date?: Date;
  /**
   * Autorise un solde negatif pour cette operation.
   *
   * Reserve aux faits deja survenus : un ticket remonte par une caisse,
   * en particulier un remboursement rendu en especes alors que le tiroir
   * paraissait vide au serveur. Le caissier a rendu l'argent ; refuser
   * l'ecriture ne le ferait pas revenir.
   *
   * Les saisies du back-office restent soumises au controle.
   */
  autoriserNegatif?: boolean;
}

/**
 * Comptes dont le solde ne peut pas devenir negatif.
 *
 * Un tiroir, une caisse ou un coffre contiennent des billets : on ne peut
 * pas en sortir ce qui n'y est pas. Une banque ou un CCP, eux, admettent
 * un decouvert, qui releve de l'accord avec l'etablissement et non du
 * logiciel.
 */
const COMPTES_ESPECES: TypeCompte[] = [
  TypeCompte.CAISSE,
  TypeCompte.TIROIR,
  TypeCompte.COFFRE,
];

@Injectable()
export class TresorerieService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numerotation: NumerotationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Enregistre une entree ou une sortie et met a jour le solde du compte
   * dans la meme transaction, sous verrou de ligne. Le solde apres est
   * grave sur l'operation : la situation de tresorerie se lit sans recalcul.
   */
  async enregistrer(
    demande: DemandeOperation,
    tx?: Prisma.TransactionClient,
  ): Promise<{ numero: string; soldeApresCentimes: number }> {
    if (demande.montantCentimes <= 0) {
      throw new BadRequestException('Le montant d’une operation doit etre positif');
    }
    const executer = async (client: Prisma.TransactionClient) => {
      const lignes = await client.$queryRaw<
        Array<{ soldeCentimes: bigint; type: TypeCompte; libelle: string }>
      >`
        SELECT "soldeCentimes", "type", "libelle" FROM "CompteTresorerie"
         WHERE "id" = ${demande.compteId} FOR UPDATE`;
      if (lignes.length === 0) throw new NotFoundException('Compte de tresorerie introuvable');

      const compte = lignes[0];
      const solde = c(compte.soldeCentimes);
      const delta =
        demande.sens === SensOperation.ENTREE ? demande.montantCentimes : -demande.montantCentimes;
      const soldeApres = solde + delta;

      if (
        soldeApres < 0 &&
        !demande.autoriserNegatif &&
        COMPTES_ESPECES.includes(compte.type)
      ) {
        throw new BadRequestException(
          `Especes insuffisantes sur ${compte.libelle} : ` +
            `${(solde / 100).toLocaleString('fr-FR')} DA en caisse, ` +
            `${(demande.montantCentimes / 100).toLocaleString('fr-FR')} DA demandes`,
        );
      }

      await client.compteTresorerie.update({
        where: { id: demande.compteId },
        data: { soldeCentimes: b(soldeApres) },
      });

      const numero = await this.numerotation.sequence('TRE', 'operation_tresorerie_numero_seq', client);
      await client.operationTresorerie.create({
        data: {
          numero,
          compteId: demande.compteId,
          sens: demande.sens,
          categorie: demande.categorie,
          montantCentimes: b(demande.montantCentimes),
          soldeApresCentimes: b(soldeApres),
          libelle: demande.libelle,
          tiersId: demande.tiersId ?? null,
          employeId: demande.employeId ?? null,
          documentType: demande.documentType,
          documentNumero: demande.documentNumero,
          transfertId: demande.transfertId,
          utilisateurId: demande.utilisateurId,
          date: demande.date ?? new Date(),
        },
      });
      return { numero, soldeApresCentimes: soldeApres };
    };

    return tx ? executer(tx) : this.prisma.$transaction(executer);
  }

  /**
   * Demande de transfert caisse vers coffre ou banque.
   * L'argent ne bouge pas tant qu'un second utilisateur n'a pas valide (M7).
   */
  async demanderTransfert(params: {
    compteSourceId: string;
    compteDestinationId: string;
    montantCentimes: number;
    motif?: string;
    utilisateurId: string;
  }) {
    if (params.compteSourceId === params.compteDestinationId) {
      throw new BadRequestException('Les comptes source et destination sont identiques');
    }
    if (params.montantCentimes <= 0) {
      throw new BadRequestException('Le montant doit etre positif');
    }

    const source = await this.prisma.compteTresorerie.findUnique({
      where: { id: params.compteSourceId },
    });
    if (!source) throw new NotFoundException('Compte source introuvable');
    if (c(source.soldeCentimes) < params.montantCentimes) {
      throw new BadRequestException(
        `Solde insuffisant sur ${source.libelle} : ` +
          `${(c(source.soldeCentimes) / 100).toLocaleString('fr-FR')} DA disponibles, ` +
          `${(params.montantCentimes / 100).toLocaleString('fr-FR')} DA demandes`,
      );
    }

    const numero = await this.numerotation.suivant('TRF-TRE');
    const transfert = await this.prisma.transfertTresorerie.create({
      data: {
        numero,
        compteSourceId: params.compteSourceId,
        compteDestinationId: params.compteDestinationId,
        montantCentimes: b(params.montantCentimes),
        motif: params.motif,
        demandeParId: params.utilisateurId,
      },
    });

    await this.audit.journaliser({
      utilisateurId: params.utilisateurId,
      action: 'tresorerie.transfert_demande',
      entite: 'TransfertTresorerie',
      entiteId: transfert.id,
      details: { numero, montantCentimes: params.montantCentimes },
    });
    return transfert;
  }

  /**
   * Validation du transfert par un second utilisateur. Le demandeur ne peut
   * pas valider sa propre demande : c'est tout l'interet de la double
   * validation exigee par M7.
   */
  async validerTransfert(transfertId: string, utilisateurId: string) {
    const transfert = await this.prisma.transfertTresorerie.findUnique({
      where: { id: transfertId },
    });
    if (!transfert) throw new NotFoundException('Transfert introuvable');
    if (transfert.statut !== StatutTransfert.EN_ATTENTE) {
      throw new BadRequestException(`Transfert deja ${transfert.statut.toLowerCase()}`);
    }
    if (transfert.demandeParId === utilisateurId) {
      throw new ForbiddenException(
        'Un transfert doit etre valide par une autre personne que celle qui l’a demande',
      );
    }

    const montant = c(transfert.montantCentimes);
    await this.prisma.$transaction(async (tx) => {
      await this.enregistrer(
        {
          compteId: transfert.compteSourceId,
          sens: SensOperation.SORTIE,
          categorie: CategorieOperation.TRANSFERT,
          montantCentimes: montant,
          libelle: `Transfert ${transfert.numero}`,
          documentType: 'TRANSFERT_TRESORERIE',
          documentNumero: transfert.numero,
          transfertId: transfert.id,
          utilisateurId,
        },
        tx,
      );
      await this.enregistrer(
        {
          compteId: transfert.compteDestinationId,
          sens: SensOperation.ENTREE,
          categorie: CategorieOperation.TRANSFERT,
          montantCentimes: montant,
          libelle: `Transfert ${transfert.numero}`,
          documentType: 'TRANSFERT_TRESORERIE',
          documentNumero: transfert.numero,
          transfertId: transfert.id,
          utilisateurId,
        },
        tx,
      );
      await tx.transfertTresorerie.update({
        where: { id: transfertId },
        data: { statut: StatutTransfert.VALIDE, valideParId: utilisateurId, valideLe: new Date() },
      });
    });

    await this.audit.journaliser({
      utilisateurId,
      action: 'tresorerie.transfert_valide',
      entite: 'TransfertTresorerie',
      entiteId: transfertId,
      details: { numero: transfert.numero, montantCentimes: montant },
    });
    return this.prisma.transfertTresorerie.findUnique({ where: { id: transfertId } });
  }

  async refuserTransfert(transfertId: string, commentaire: string, utilisateurId: string) {
    const transfert = await this.prisma.transfertTresorerie.findUnique({ where: { id: transfertId } });
    if (!transfert) throw new NotFoundException('Transfert introuvable');
    if (transfert.statut !== StatutTransfert.EN_ATTENTE) {
      throw new BadRequestException('Transfert deja traite');
    }
    return this.prisma.transfertTresorerie.update({
      where: { id: transfertId },
      data: {
        statut: StatutTransfert.REFUSE,
        valideParId: utilisateurId,
        valideLe: new Date(),
        commentaireRefus: commentaire,
      },
    });
  }

  /** Situation de tresorerie en temps reel, par compte et consolidee (M7). */
  async situation(magasinIds: string[]) {
    const comptes = await this.prisma.compteTresorerie.findMany({
      where: { actif: true, OR: [{ magasinId: { in: magasinIds } }, { magasinId: null }] },
      orderBy: [{ type: 'asc' }, { libelle: 'asc' }],
      include: { magasin: { select: { code: true, nom: true } } },
    });

    const parType = new Map<string, number>();
    let total = 0;
    for (const compte of comptes) {
      const solde = c(compte.soldeCentimes);
      total += solde;
      parType.set(compte.type, (parType.get(compte.type) ?? 0) + solde);
    }

    return {
      comptes: comptes.map((compte) => ({
        id: compte.id,
        code: compte.code,
        libelle: compte.libelle,
        type: compte.type,
        magasin: compte.magasin,
        soldeCentimes: c(compte.soldeCentimes),
      })),
      parType: [...parType.entries()].map(([type, soldeCentimes]) => ({ type, soldeCentimes })),
      totalCentimes: total,
    };
  }

  /** Journal d'un compte, avec filtre de periode et de categorie. */
  journal(params: {
    compteId?: string;
    categorie?: CategorieOperation;
    depuis?: Date;
    jusqua?: Date;
    pointee?: boolean;
    taille?: number;
  }) {
    return this.prisma.operationTresorerie.findMany({
      where: {
        ...(params.compteId ? { compteId: params.compteId } : {}),
        ...(params.categorie ? { categorie: params.categorie } : {}),
        ...(params.pointee !== undefined ? { pointee: params.pointee } : {}),
        ...(params.depuis || params.jusqua
          ? {
              date: {
                ...(params.depuis ? { gte: params.depuis } : {}),
                ...(params.jusqua ? { lte: params.jusqua } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: 'desc' },
      take: Math.min(params.taille ?? 200, 1000),
      include: {
        compte: { select: { code: true, libelle: true, type: true } },
        tiers: { select: { code: true, raisonSociale: true } },
        utilisateur: { select: { code: true, nom: true } },
      },
    });
  }

  /** Pointage d'une operation pour le rapprochement bancaire (M7). */
  async pointer(operationIds: string[], pointee: boolean) {
    const resultat = await this.prisma.operationTresorerie.updateMany({
      where: { id: { in: operationIds } },
      data: { pointee, dateRapprochement: pointee ? new Date() : null },
    });
    return { modifiees: resultat.count };
  }
}
