import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TypeBon } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumerotationService } from '../commun/numerotation.service';
import { AuditService } from '../audit/audit.service';
import { b, c } from '../commun/bigint';
import {
  appliquerUsageBon, pointsGagnes, valeurDesPoints,
  BAREME_FIDELITE_DEFAUT, type BaremeFidelite,
} from '@gestglobale/shared';

/**
 * Fidelite et bons d'achat (M10).
 *
 * Les points et les soldes de bons sont tenus par des ecritures, jamais
 * par une valeur posee : un solde doit toujours pouvoir se justifier
 * ligne par ligne devant un client qui le conteste.
 */
@Injectable()
export class FideliteService {
  private readonly logger = new Logger(FideliteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numerotation: NumerotationService,
    private readonly audit: AuditService,
  ) {}

  /** Bareme en vigueur pour ce magasin, ou celui du siege. */
  async bareme(magasinId?: string | null): Promise<BaremeFidelite> {
    const parametre =
      (magasinId
        ? await this.prisma.parametre.findFirst({ where: { cle: 'caisse.fidelite', magasinId } })
        : null) ??
      (await this.prisma.parametre.findFirst({
        where: { cle: 'caisse.fidelite', magasinId: null },
      }));
    if (!parametre) return BAREME_FIDELITE_DEFAUT;
    return { ...BAREME_FIDELITE_DEFAUT, ...(parametre.valeur as object) } as BaremeFidelite;
  }

  /**
   * Credite les points gagnes par un ticket.
   *
   * Idempotent sur le couple (client, document, motif) : un ticket
   * renvoye apres un accuse perdu ne credite pas deux fois.
   */
  async crediterPoints(
    params: {
      clientId: string;
      documentNumero: string;
      montantTtcCentimes: number;
      magasinId?: string | null;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ points: number; soldeApres: number }> {
    const bareme = await this.bareme(params.magasinId);
    const points = pointsGagnes(params.montantTtcCentimes, bareme);
    if (points <= 0) return { points: 0, soldeApres: 0 };

    const executer = async (client: Prisma.TransactionClient) => {
      const dejaFait = await client.mouvementFidelite.findUnique({
        where: {
          clientId_documentNumero_motif: {
            clientId: params.clientId,
            documentNumero: params.documentNumero,
            motif: 'VENTE',
          },
        },
      });
      if (dejaFait) return { points: dejaFait.points, soldeApres: dejaFait.soldeApres };

      const tiers = await client.tiers.update({
        where: { id: params.clientId },
        data: { pointsFidelite: { increment: points } },
        select: { pointsFidelite: true },
      });
      await client.mouvementFidelite.create({
        data: {
          clientId: params.clientId,
          points,
          soldeApres: tiers.pointsFidelite,
          motif: 'VENTE',
          documentNumero: params.documentNumero,
        },
      });
      return { points, soldeApres: tiers.pointsFidelite };
    };

    return tx ? executer(tx) : this.prisma.$transaction(executer);
  }

  /** Debite des points utilises en remise. */
  async debiterPoints(
    params: { clientId: string; points: number; documentNumero: string },
    tx?: Prisma.TransactionClient,
  ): Promise<{ soldeApres: number }> {
    if (params.points <= 0) return { soldeApres: 0 };

    const executer = async (client: Prisma.TransactionClient) => {
      const dejaFait = await client.mouvementFidelite.findUnique({
        where: {
          clientId_documentNumero_motif: {
            clientId: params.clientId,
            documentNumero: params.documentNumero,
            motif: 'UTILISATION',
          },
        },
      });
      if (dejaFait) return { soldeApres: dejaFait.soldeApres };

      const avant = await client.tiers.findUniqueOrThrow({
        where: { id: params.clientId },
        select: { pointsFidelite: true },
      });
      // Le solde ne descend jamais sous zero : hors ligne, la caisse a pu
      // travailler sur un solde perime.
      const retires = Math.min(avant.pointsFidelite, params.points);
      const tiers = await client.tiers.update({
        where: { id: params.clientId },
        data: { pointsFidelite: avant.pointsFidelite - retires },
        select: { pointsFidelite: true },
      });
      await client.mouvementFidelite.create({
        data: {
          clientId: params.clientId,
          points: -retires,
          soldeApres: tiers.pointsFidelite,
          motif: 'UTILISATION',
          documentNumero: params.documentNumero,
        },
      });
      return { soldeApres: tiers.pointsFidelite };
    };

    return tx ? executer(tx) : this.prisma.$transaction(executer);
  }

  /** Valeur en dinars des points d'un client, selon le bareme. */
  async valeurPoints(clientId: string): Promise<{ points: number; valeurCentimes: number }> {
    const tiers = await this.prisma.tiers.findUniqueOrThrow({
      where: { id: clientId },
      select: { pointsFidelite: true },
    });
    const bareme = await this.bareme();
    return {
      points: tiers.pointsFidelite,
      valeurCentimes: valeurDesPoints(tiers.pointsFidelite, bareme),
    };
  }

  /**
   * Convertit les points d'un client en bon d'achat.
   *
   * Les points ne paient pas directement : un bon porte un code, une
   * trace et une contrepartie comptable, alors qu'une remise en points
   * n'aurait ni l'un ni l'autre. La conversion exige le reseau — une
   * caisse hors ligne ne peut pas inventer un code sans risquer que deux
   * caisses emettent le meme.
   */
  async convertirPoints(params: {
    clientId: string;
    points: number;
    utilisateurId: string;
    expireLe?: string;
  }) {
    const bareme = await this.bareme();
    const client = await this.prisma.tiers.findUniqueOrThrow({
      where: { id: params.clientId },
      select: { id: true, code: true, raisonSociale: true, pointsFidelite: true },
    });

    const points = Math.floor(params.points);
    if (points <= 0) {
      throw new BadRequestException('Indiquez le nombre de points a convertir');
    }
    if (points > client.pointsFidelite) {
      throw new BadRequestException(
        `${client.raisonSociale} n’a que ${client.pointsFidelite} point`
        + `${client.pointsFidelite > 1 ? 's' : ''}`,
      );
    }
    if (points < bareme.minimumUtilisation) {
      throw new BadRequestException(
        `Il faut au moins ${bareme.minimumUtilisation} points pour obtenir un bon`,
      );
    }

    const montantCentimes = valeurDesPoints(points, bareme);
    if (montantCentimes <= 0) {
      throw new BadRequestException(
        'Ces points ne valent pas encore un dinar entier',
      );
    }

    // Le code est pris hors transaction : le compteur est sans trou, donc
    // sequentiel, et le garder dans la transaction serialiserait toutes
    // les emissions. Si la suite echoue, le code est perdu — un numero de
    // bon manquant est sans consequence, contrairement a une facture.
    const code = await this.numerotation.suivant('BON');

    const bon = await this.prisma.$transaction(async (tx) => {
      await this.debiterPoints(
        { clientId: params.clientId, points, documentNumero: code },
        tx,
      );
      return tx.bonAchat.create({
        data: {
          code,
          type: TypeBon.BON_ACHAT,
          montantCentimes: b(montantCentimes),
          soldeCentimes: b(montantCentimes),
          expireLe: params.expireLe ? new Date(params.expireLe) : null,
          clientId: params.clientId,
          emisParId: params.utilisateurId,
        },
      });
    });

    await this.audit.journaliser({
      utilisateurId: params.utilisateurId,
      action: 'fidelite.points_convertis',
      entite: 'BonAchat',
      entiteId: bon.id,
      details: {
        clientCode: client.code,
        points,
        montantCentimes,
        code,
        pointsRestants: client.pointsFidelite - points,
      },
    });

    return {
      bon,
      points,
      montantCentimes,
      pointsRestants: client.pointsFidelite - points,
    };
  }

  /** Emet une carte cadeau ou un bon d'achat. */
  async emettre(params: {
    type: TypeBon;
    montantCentimes: number;
    nombre?: number;
    expireLe?: string;
    clientId?: string;
    utilisateurId: string;
  }) {
    if (params.montantCentimes <= 0) {
      throw new BadRequestException('Le montant du bon doit etre positif');
    }
    const nombre = Math.min(Math.max(params.nombre ?? 1, 1), 200);
    const prefixe = params.type === TypeBon.CARTE_CADEAU ? 'CAD' : 'BON';
    const emis = [];

    for (let i = 0; i < nombre; i++) {
      const code = await this.numerotation.suivant(prefixe);
      emis.push(
        await this.prisma.bonAchat.create({
          data: {
            code,
            type: params.type,
            montantCentimes: b(params.montantCentimes),
            soldeCentimes: b(params.montantCentimes),
            expireLe: params.expireLe ? new Date(params.expireLe) : null,
            clientId: params.clientId,
            emisParId: params.utilisateurId,
          },
        }),
      );
    }

    await this.audit.journaliser({
      utilisateurId: params.utilisateurId,
      action: 'fidelite.bons_emis',
      entite: 'BonAchat',
      details: {
        type: params.type,
        nombre,
        montantCentimes: params.montantCentimes,
        codes: emis.map((e) => e.code),
      },
    });
    return emis;
  }

  /**
   * Enregistre l'usage d'un bon par un document.
   *
   * Idempotent sur le couple (bon, document). Le solde reel du serveur
   * fait foi : si la caisse a accepte davantage pendant une coupure, la
   * vente tient et l'ecart est consigne pour le gerant.
   */
  async enregistrerUsage(
    params: {
      code: string;
      documentNumero: string;
      montantCentimes: number;
      horsLigne: boolean;
      utilisateurId?: string | null;
      /**
       * Date de la vente. Un ticket remonte apres coup doit etre juge
       * avec ce que le bon valait au moment ou le client l'a presente,
       * pas avec son etat du jour.
       */
      date?: Date;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<{ debiteCentimes: number; decouvertCentimes: number; soldeApresCentimes: number }> {
    const executer = async (client: Prisma.TransactionClient) => {
      const bon = await client.bonAchat.findUnique({ where: { code: params.code } });
      if (!bon) {
        throw new NotFoundException(`Bon inconnu : ${params.code}`);
      }

      const dejaFait = await client.utilisationBon.findUnique({
        where: {
          bonId_documentNumero: { bonId: bon.id, documentNumero: params.documentNumero },
        },
      });
      if (dejaFait) {
        return {
          debiteCentimes: c(dejaFait.montantCentimes),
          decouvertCentimes: c(dejaFait.decouvertCentimes),
          soldeApresCentimes: c(dejaFait.soldeApresCentimes),
        };
      }

      // Verrou de ligne : deux tickets presentant le meme bon ne peuvent
      // pas partir du meme solde.
      const lignes = await client.$queryRaw<Array<{ soldeCentimes: bigint }>>`
        SELECT "soldeCentimes" FROM "BonAchat" WHERE "id" = ${bon.id} FOR UPDATE`;
      const solde = c(lignes[0]?.soldeCentimes);

      // Le bon etait-il valable quand le client l'a presente ? Une carte
      // declaree perdue puis annulee peut encore etre acceptee par une
      // caisse hors ligne : la vente tient, mais son solde ne doit pas
      // partir, sinon le client honnete perd son argent deux fois.
      const dateVente = params.date ?? new Date();
      const annuleAvant = !bon.actif
        && (bon.annuleLe === null || bon.annuleLe <= dateVente);
      const expireAvant = bon.expireLe !== null && bon.expireLe < dateVente;
      const valable = !annuleAvant && !expireAvant;

      const resultat = appliquerUsageBon(solde, params.montantCentimes, { valable });

      await client.bonAchat.update({
        where: { id: bon.id },
        data: {
          soldeCentimes: b(resultat.soldeApresCentimes),
          utilise: resultat.soldeApresCentimes <= 0,
        },
      });
      await client.utilisationBon.create({
        data: {
          bonId: bon.id,
          documentNumero: params.documentNumero,
          montantCentimes: b(resultat.debiteCentimes),
          soldeApresCentimes: b(resultat.soldeApresCentimes),
          decouvertCentimes: b(resultat.decouvertCentimes),
          horsLigne: params.horsLigne,
          utilisateurId: params.utilisateurId ?? null,
        },
      });

      if (resultat.decouvertCentimes > 0) {
        const cause = annuleAvant
          ? 'il etait annule'
          : expireAvant
            ? 'il etait expire'
            : `son solde etait de ${solde / 100} DA`;
        this.logger.warn(
          `Bon ${params.code} presente pour ${params.montantCentimes / 100} DA ` +
            `alors que ${cause} (document ${params.documentNumero})`,
        );
      }
      return resultat;
    };

    return tx ? executer(tx) : this.prisma.$transaction(executer);
  }

  /** Bons dont le solde connu de la caisse n'a pas suffi (M10). */
  async decouverts(jours = 30) {
    const depuis = new Date();
    depuis.setDate(depuis.getDate() - jours);
    return this.prisma.utilisationBon.findMany({
      where: { decouvertCentimes: { gt: 0 }, date: { gte: depuis } },
      orderBy: { date: 'desc' },
      take: 200,
      include: { bon: { select: { code: true, type: true, montantCentimes: true } } },
    });
  }

  async bons(params: { actifs?: boolean; clientId?: string; code?: string }) {
    return this.prisma.bonAchat.findMany({
      where: {
        ...(params.code ? { code: params.code } : {}),
        ...(params.clientId ? { clientId: params.clientId } : {}),
        ...(params.actifs ? { actif: true, utilise: false } : {}),
      },
      orderBy: { emisLe: 'desc' },
      take: 300,
      include: {
        client: { select: { code: true, raisonSociale: true } },
        // L'ecran du gerant montre chaque passage du bon et le
        // depassement eventuel : le compte seul ne suffit pas.
        utilisations: {
          orderBy: { date: 'asc' },
          select: {
            documentNumero: true, montantCentimes: true,
            decouvertCentimes: true, horsLigne: true, date: true, creeLe: true,
          },
        },
      },
    });
  }

  /** Annule un bon : son solde devient inutilisable. */
  async annuler(id: string, motif: string, utilisateurId: string) {
    const bon = await this.prisma.bonAchat.update({
      where: { id },
      data: { actif: false, motifAnnulation: motif, annuleLe: new Date() },
    });
    await this.audit.journaliser({
      utilisateurId,
      action: 'fidelite.bon_annule',
      entite: 'BonAchat',
      entiteId: id,
      details: { code: bon.code, motif, soldeCentimes: c(bon.soldeCentimes) },
    });
    return bon;
  }
}
