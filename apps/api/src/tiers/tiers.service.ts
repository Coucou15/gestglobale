import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SensMouvementTiers, TypeTiers } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { b, c } from '../commun/bigint';
import { evaluerCredit, type DecisionCredit } from '@gestglobale/shared';

@Injectable()
export class TiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async rechercher(params: {
    texte?: string;
    type?: TypeTiers;
    bloque?: boolean;
    avecSolde?: boolean;
    page?: number;
    taille?: number;
  }) {
    const taille = Math.min(params.taille ?? 50, 200);
    const saut = (Math.max(params.page ?? 1, 1) - 1) * taille;
    const texte = params.texte?.trim();

    const where: Prisma.TiersWhereInput = {
      ...(params.type ? { OR: [{ type: params.type }, { type: TypeTiers.LES_DEUX }] } : {}),
      ...(params.bloque !== undefined ? { bloque: params.bloque } : {}),
      ...(params.avecSolde ? { soldeCentimes: { not: BigInt(0) } } : {}),
      ...(texte
        ? {
            AND: [
              {
                OR: [
                  { code: { contains: texte, mode: 'insensitive' } },
                  { raisonSociale: { contains: texte, mode: 'insensitive' } },
                  { telephone: { contains: texte } },
                  { carteFidelite: texte },
                ],
              },
            ],
          }
        : {}),
    };

    const [tiers, total] = await Promise.all([
      this.prisma.tiers.findMany({
        where,
        take: taille,
        skip: saut,
        orderBy: { raisonSociale: 'asc' },
      }),
      this.prisma.tiers.count({ where }),
    ]);
    return { total, page: params.page ?? 1, taille, tiers };
  }

  async parId(id: string) {
    const tiers = await this.prisma.tiers.findUnique({
      where: { id },
      include: {
        echeances: { where: { soldee: false }, orderBy: { dateEcheance: 'asc' } },
        magasinInterne: { select: { code: true, nom: true } },
      },
    });
    if (!tiers) throw new NotFoundException('Tiers introuvable');
    return tiers;
  }

  /**
   * Releve de compte : chaque mouvement porte deja le solde obtenu, donc
   * le releve se lit sans recalcul, meme sur plusieurs annees (M6).
   */
  async releve(tiersId: string, depuis?: Date, jusqua?: Date) {
    const [tiers, mouvements] = await Promise.all([
      this.parId(tiersId),
      this.prisma.mouvementTiers.findMany({
        where: {
          tiersId,
          ...(depuis || jusqua
            ? { date: { ...(depuis ? { gte: depuis } : {}), ...(jusqua ? { lte: jusqua } : {}) } }
            : {}),
        },
        orderBy: { date: 'asc' },
        take: 2000,
        include: { utilisateur: { select: { code: true, nom: true } } },
      }),
    ]);

    return {
      tiers: {
        id: tiers.id,
        code: tiers.code,
        raisonSociale: tiers.raisonSociale,
        soldeCentimes: c(tiers.soldeCentimes),
        plafondCreditCentimes: c(tiers.plafondCreditCentimes),
        bloque: tiers.bloque,
      },
      mouvements,
      totalDebitCentimes: mouvements
        .filter((m) => m.sens === SensMouvementTiers.DEBIT)
        .reduce((t, m) => t + c(m.montantCentimes), 0),
      totalCreditCentimes: mouvements
        .filter((m) => m.sens === SensMouvementTiers.CREDIT)
        .reduce((t, m) => t + c(m.montantCentimes), 0),
    };
  }

  /**
   * Ecrit un mouvement et met a jour le solde dans la meme transaction.
   *
   * Le solde du tiers est lu sous verrou : deux ventes a credit simultanees
   * ne peuvent pas partir du meme solde et faire depasser le plafond.
   */
  async enregistrerMouvement(
    params: {
      tiersId: string;
      sens: SensMouvementTiers;
      montantCentimes: number;
      categorie: string;
      libelle: string;
      documentType?: string;
      documentId?: string;
      documentNumero?: string;
      utilisateurId: string;
      date?: Date;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ soldeApresCentimes: number }> {
    const executer = async (client: Prisma.TransactionClient) => {
      const lignes = await client.$queryRaw<Array<{ soldeCentimes: bigint }>>`
        SELECT "soldeCentimes" FROM "Tiers" WHERE "id" = ${params.tiersId} FOR UPDATE`;
      if (lignes.length === 0) throw new NotFoundException('Tiers introuvable');

      const solde = c(lignes[0].soldeCentimes);
      const delta =
        params.sens === SensMouvementTiers.DEBIT
          ? params.montantCentimes
          : -params.montantCentimes;
      const soldeApres = solde + delta;

      await client.tiers.update({
        where: { id: params.tiersId },
        data: { soldeCentimes: b(soldeApres) },
      });
      await client.mouvementTiers.create({
        data: {
          tiersId: params.tiersId,
          sens: params.sens,
          montantCentimes: b(params.montantCentimes),
          soldeApresCentimes: b(soldeApres),
          categorie: params.categorie,
          libelle: params.libelle,
          documentType: params.documentType,
          documentId: params.documentId,
          documentNumero: params.documentNumero,
          utilisateurId: params.utilisateurId,
          date: params.date ?? new Date(),
        },
      });
      return { soldeApresCentimes: soldeApres };
    };

    return tx ? executer(tx) : this.prisma.$transaction(executer);
  }

  /**
   * Evalue une vente a credit avant encaissement (M5, section 4.5).
   * Hors ligne la caisse fait le meme calcul sur sa copie locale.
   */
  async evaluerCredit(
    tiersId: string,
    montantCentimes: number,
    options: { horsLigne?: boolean } = {},
  ): Promise<DecisionCredit> {
    const tiers = await this.prisma.tiers.findUnique({ where: { id: tiersId } });
    if (!tiers) throw new NotFoundException('Client introuvable');

    const impayes = await this.prisma.echeance.aggregate({
      where: { tiersId, soldee: false, dateEcheance: { lt: new Date() } },
      _sum: { montantCentimes: true, regleCentimes: true },
    });
    const impayeEchu =
      c(impayes._sum.montantCentimes) - c(impayes._sum.regleCentimes);

    return evaluerCredit(
      {
        soldeCentimes: c(tiers.soldeCentimes),
        plafondCentimes: c(tiers.plafondCreditCentimes),
        bloqueManuellement: tiers.bloque,
        motifBlocageManuel: tiers.motifBlocage,
        impayeEchuCentimes: Math.max(0, impayeEchu),
      },
      montantCentimes,
      options,
    );
  }

  async bloquer(tiersId: string, motif: string, utilisateurId: string) {
    const tiers = await this.prisma.tiers.update({
      where: { id: tiersId },
      data: { bloque: true, motifBlocage: motif },
    });
    await this.audit.journaliser({
      utilisateurId,
      action: 'tiers.blocage',
      entite: 'Tiers',
      entiteId: tiersId,
      details: { motif },
    });
    return tiers;
  }

  async debloquer(tiersId: string, utilisateurId: string) {
    const tiers = await this.prisma.tiers.update({
      where: { id: tiersId },
      data: { bloque: false, motifBlocage: null },
    });
    await this.audit.journaliser({
      utilisateurId,
      action: 'tiers.deblocage',
      entite: 'Tiers',
      entiteId: tiersId,
    });
    return tiers;
  }

  /**
   * Fusion de doublons (M6) : tout l'historique du tiers absorbe est
   * rattache au tiers conserve, les soldes sont additionnes, et le double
   * est desactive plutot que supprime pour ne rien perdre.
   */
  async fusionner(conserveId: string, absorbeId: string, utilisateurId: string) {
    if (conserveId === absorbeId) {
      throw new BadRequestException('Les deux tiers sont identiques');
    }
    const [conserve, absorbe] = await Promise.all([
      this.prisma.tiers.findUnique({ where: { id: conserveId } }),
      this.prisma.tiers.findUnique({ where: { id: absorbeId } }),
    ]);
    if (!conserve || !absorbe) throw new NotFoundException('Tiers introuvable');

    const resultat = await this.prisma.$transaction(async (tx) => {
      await tx.documentVente.updateMany({
        where: { clientId: absorbeId },
        data: { clientId: conserveId },
      });
      await tx.mouvementTiers.updateMany({
        where: { tiersId: absorbeId },
        data: { tiersId: conserveId },
      });
      await tx.echeance.updateMany({
        where: { tiersId: absorbeId },
        data: { tiersId: conserveId },
      });

      const nouveauSolde = c(conserve.soldeCentimes) + c(absorbe.soldeCentimes);
      const fusionne = await tx.tiers.update({
        where: { id: conserveId },
        data: {
          soldeCentimes: b(nouveauSolde),
          pointsFidelite: conserve.pointsFidelite + absorbe.pointsFidelite,
          // La carte de l'absorbe est reprise si le conserve n'en a pas :
          // c'est le cas des 3 460 cartes anonymes a rattacher.
          carteFidelite: conserve.carteFidelite ?? absorbe.carteFidelite,
        },
      });

      await tx.tiers.update({
        where: { id: absorbeId },
        data: {
          actif: false,
          carteFidelite: null,
          soldeCentimes: BigInt(0),
          motifBlocage: `Fusionne dans ${conserve.code}`,
          bloque: true,
        },
      });
      return fusionne;
    });

    await this.audit.journaliser({
      utilisateurId,
      action: 'tiers.fusion',
      entite: 'Tiers',
      entiteId: conserveId,
      details: { absorbe: absorbe.code, conserve: conserve.code },
    });
    return resultat;
  }

  /** Impayes echus, pour la relance par SMS ou WhatsApp (M6). */
  async impayes(joursRetard = 0) {
    const limite = new Date();
    limite.setDate(limite.getDate() - joursRetard);

    const echeances = await this.prisma.echeance.findMany({
      where: { soldee: false, dateEcheance: { lt: limite } },
      orderBy: { dateEcheance: 'asc' },
      include: {
        tiers: {
          select: { id: true, code: true, raisonSociale: true, telephone: true, soldeCentimes: true },
        },
      },
      take: 500,
    });

    return echeances.map((e) => ({
      ...e,
      resteDuCentimes: c(e.montantCentimes) - c(e.regleCentimes),
      joursRetard: Math.floor((Date.now() - e.dateEcheance.getTime()) / 86400000),
    }));
  }
}
