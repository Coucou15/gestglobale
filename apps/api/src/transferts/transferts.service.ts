import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StatutTransfertStock, TypeEmplacement, TypeMouvement } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StocksService } from '../stocks/stocks.service';
import { NumerotationService } from '../commun/numerotation.service';
import { AuditService } from '../audit/audit.service';
import { b, c } from '../commun/bigint';

/**
 * Transferts inter-magasins (M11).
 *
 * En deux temps, parce que la marchandise met du temps a arriver : un
 * bon d'expedition au depart, un bon de reception a l'arrivee.
 *
 * Entre les deux, elle est **en transit** : dans aucun rayon, mais
 * toujours dans les comptes du magasin expediteur, jusqu'a ce que
 * quelqu'un signe pour elle. Traiter le transfert en un seul geste
 * ferait apparaitre a 8 h, dans le magasin d'arrivee, une palette encore
 * sur le camion — et ferait disparaitre la marchandise des deux
 * magasins si le camion n'arrivait jamais.
 *
 * Ce qui est recu peut differer de ce qui est parti. L'ecart n'est pas
 * absorbe en silence : il reste au magasin expediteur, qui a laisse
 * partir la marchandise, et il est consigne ligne par ligne.
 */
@Injectable()
export class TransfertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stocks: StocksService,
    private readonly numerotation: NumerotationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Emplacement de transit d'un magasin, cree au besoin.
   *
   * Un par magasin expediteur : la marchandise sur la route reste la
   * sienne, et son inventaire doit pouvoir la retrouver.
   */
  private async transitDe(
    magasinId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const existant = await tx.emplacement.findFirst({
      where: { magasinId, type: TypeEmplacement.TRANSIT },
      select: { id: true },
    });
    if (existant) return existant.id;

    const cree = await tx.emplacement.create({
      data: {
        magasinId,
        code: 'TR',
        nom: 'En transit',
        type: TypeEmplacement.TRANSIT,
      },
      select: { id: true },
    });
    return cree.id;
  }

  /** Prepare un bon d'expedition. Rien ne bouge encore. */
  async preparer(params: {
    magasinSourceId: string;
    magasinDestinationId: string;
    emplacementSourceId: string;
    emplacementDestinationId: string;
    lignes: Array<{ articleId: string; quantiteMilli: number }>;
    motif?: string;
    utilisateurId: string;
  }) {
    if (params.magasinSourceId === params.magasinDestinationId) {
      throw new BadRequestException(
        'Un transfert inter-magasins relie deux magasins differents. '
        + 'Pour deplacer du stock a l’interieur d’un magasin, utilisez un '
        + 'transfert entre emplacements.',
      );
    }
    if (params.lignes.length === 0) {
      throw new BadRequestException('Un bon d’expedition sans ligne n’a pas de sens');
    }

    // Un article deux fois sur le meme bon rendrait le comptage a
    // l'arrivee ambigu : lequel des deux a-t-on recu ?
    const vus = new Set<string>();
    for (const ligne of params.lignes) {
      if (ligne.quantiteMilli <= 0) {
        throw new BadRequestException('Chaque quantite expediee doit etre positive');
      }
      if (vus.has(ligne.articleId)) {
        throw new BadRequestException(
          'Un meme article figure deux fois : regroupez les quantites sur une seule ligne',
        );
      }
      vus.add(ligne.articleId);
    }

    await this.verifierEmplacements(params);

    const articles = await this.prisma.article.findMany({
      where: { id: { in: params.lignes.map((l) => l.articleId) } },
      select: { id: true, cumpCentimes: true },
    });
    const cump = new Map(articles.map((a) => [a.id, a.cumpCentimes]));
    if (articles.length !== vus.size) {
      throw new BadRequestException('Un des articles du bon est introuvable');
    }

    const numero = await this.numerotation.suivant('TRF');

    const transfert = await this.prisma.transfertStock.create({
      data: {
        numero,
        magasinSourceId: params.magasinSourceId,
        magasinDestinationId: params.magasinDestinationId,
        emplacementSourceId: params.emplacementSourceId,
        emplacementDestinationId: params.emplacementDestinationId,
        motif: params.motif,
        creeParId: params.utilisateurId,
        lignes: {
          create: params.lignes.map((l) => ({
            articleId: l.articleId,
            quantiteMilli: l.quantiteMilli,
            // Le cout est fige au depart : c'est a ce prix que la
            // marchandise entrera chez le destinataire, quelle que soit
            // l'evolution du CUMP pendant le trajet.
            cumpCentimes: cump.get(l.articleId) ?? b(0),
          })),
        },
      },
      include: this.inclusions(),
    });

    await this.audit.journaliser({
      utilisateurId: params.utilisateurId,
      action: 'transfert.prepare',
      entite: 'TransfertStock',
      entiteId: transfert.id,
      details: { numero, lignes: params.lignes.length },
    });

    return this.enSortie(transfert);
  }

  private async verifierEmplacements(params: {
    magasinSourceId: string;
    magasinDestinationId: string;
    emplacementSourceId: string;
    emplacementDestinationId: string;
  }) {
    const [source, destination] = await Promise.all([
      this.prisma.emplacement.findUnique({
        where: { id: params.emplacementSourceId },
        select: { magasinId: true, type: true, nom: true },
      }),
      this.prisma.emplacement.findUnique({
        where: { id: params.emplacementDestinationId },
        select: { magasinId: true, type: true, nom: true },
      }),
    ]);
    if (!source || !destination) {
      throw new NotFoundException('Emplacement introuvable');
    }
    if (source.magasinId !== params.magasinSourceId) {
      throw new BadRequestException(
        `L’emplacement de depart « ${source.nom} » n’appartient pas au magasin expediteur`,
      );
    }
    if (destination.magasinId !== params.magasinDestinationId) {
      throw new BadRequestException(
        `L’emplacement d’arrivee « ${destination.nom} » n’appartient pas au magasin destinataire`,
      );
    }
    for (const [lieu, emplacement] of [['depart', source], ['arrivee', destination]] as const) {
      if (emplacement.type === TypeEmplacement.TRANSIT) {
        throw new BadRequestException(
          `L’emplacement de ${lieu} ne peut pas etre un emplacement de transit`,
        );
      }
    }
  }

  /**
   * Expedie : la marchandise quitte le rayon pour le transit.
   *
   * Le stock negatif est refuse ici, contrairement a une vente : rien
   * n'a encore eu lieu, on peut donc dire non. Expedier ce qu'on n'a pas
   * creerait du stock a l'arrivee sans contrepartie.
   */
  async expedier(id: string, utilisateurId: string) {
    return this.prisma.$transaction(async (tx) => {
      const transfert = await tx.transfertStock.findUnique({
        where: { id },
        include: { lignes: true },
      });
      if (!transfert) throw new NotFoundException('Transfert introuvable');
      if (transfert.statut !== StatutTransfertStock.PREPARE) {
        throw new BadRequestException(
          `Ce bon est deja ${this.enClair(transfert.statut)} : il ne peut plus etre expedie`,
        );
      }

      const transitId = await this.transitDe(transfert.magasinSourceId, tx);

      for (const ligne of transfert.lignes) {
        await this.stocks.appliquer({
          type: TypeMouvement.TRANSFERT_SORTIE,
          articleId: ligne.articleId,
          emplacementId: transfert.emplacementSourceId,
          quantiteMilli: -ligne.quantiteMilli,
          documentType: 'TRANSFERT',
          documentNumero: transfert.numero,
          motif: transfert.motif ?? undefined,
          utilisateurId,
        }, tx);

        await this.stocks.appliquer({
          type: TypeMouvement.TRANSFERT_ENTREE,
          articleId: ligne.articleId,
          emplacementId: transitId,
          quantiteMilli: ligne.quantiteMilli,
          documentType: 'TRANSFERT',
          documentNumero: transfert.numero,
          motif: 'En transit',
          utilisateurId,
        }, tx);
      }

      const maj = await tx.transfertStock.update({
        where: { id },
        data: {
          statut: StatutTransfertStock.EXPEDIE,
          expedieParId: utilisateurId,
          expedieLe: new Date(),
        },
        include: this.inclusions(),
      });

      await this.audit.journaliser({
        utilisateurId,
        action: 'transfert.expedie',
        entite: 'TransfertStock',
        entiteId: id,
        details: { numero: transfert.numero, lignes: transfert.lignes.length },
      });

      return this.enSortie(maj);
    });
  }

  /**
   * Receptionne : le transit est solde, le rayon d'arrivee est credite
   * de ce qui a ete **compte**, pas de ce qui etait annonce.
   *
   * L'ecart reste au magasin expediteur sous forme de mouvement dedie.
   * C'est lui qui a laisse partir la marchandise ; lui faire porter le
   * manque est la seule facon de garder deux comptabilites justes. Si
   * le destinataire compte davantage, le surplus lui est credite et
   * l'ecart joue en sens inverse.
   */
  async receptionner(params: {
    id: string;
    lignes: Array<{ articleId: string; quantiteRecueMilli: number; motifEcart?: string }>;
    commentaire?: string;
    utilisateurId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const transfert = await tx.transfertStock.findUnique({
        where: { id: params.id },
        include: { lignes: true },
      });
      if (!transfert) throw new NotFoundException('Transfert introuvable');
      if (transfert.statut !== StatutTransfertStock.EXPEDIE) {
        throw new BadRequestException(
          transfert.statut === StatutTransfertStock.PREPARE
            ? 'Ce bon n’est pas encore expedie'
            : `Ce bon est deja ${this.enClair(transfert.statut)}`,
        );
      }

      const comptees = new Map(
        params.lignes.map((l) => [l.articleId, l]),
      );
      for (const articleId of comptees.keys()) {
        if (!transfert.lignes.some((l) => l.articleId === articleId)) {
          throw new BadRequestException(
            'Un article compte ne figure pas sur le bon d’expedition',
          );
        }
      }

      const transitId = await this.transitDe(transfert.magasinSourceId, tx);
      const numeroReception = await this.numerotation.suivant('BRT', { tx });
      let avecEcart = false;

      for (const ligne of transfert.lignes) {
        const compte = comptees.get(ligne.articleId);
        // Une ligne non comptee vaut « rien recu » : il faut un geste
        // explicite pour dire qu'une palette est arrivee, jamais un
        // silence.
        const recue = compte ? Math.max(0, Math.round(compte.quantiteRecueMilli)) : 0;
        const ecart = recue - ligne.quantiteMilli;

        // Le transit laisse partir exactement ce qui est arrive ; le
        // reste s'en va par le mouvement d'ecart juste apres. Les deux
        // additionnes font la quantite expediee, donc le transit retombe
        // toujours a zero.
        //
        // Le solder d'emblee de la totalite expediee, puis retirer
        // l'ecart, comptait le manquant deux fois : un bidon casse en
        // faisait disparaitre deux des comptes du groupe.
        if (recue > 0) {
          await this.stocks.appliquer({
            type: TypeMouvement.TRANSFERT_SORTIE,
            articleId: ligne.articleId,
            emplacementId: transitId,
            quantiteMilli: -recue,
            documentType: 'TRANSFERT',
            documentNumero: numeroReception,
            motif: 'Fin de transit',
            utilisateurId: params.utilisateurId,
            // Un excedent compte a l'arrivee creuse le transit le temps
            // que le mouvement d'ecart le remette a zero.
            autoriserNegatif: true,
          }, tx);
        }

        if (recue > 0) {
          await this.stocks.appliquer({
            type: TypeMouvement.TRANSFERT_ENTREE,
            articleId: ligne.articleId,
            emplacementId: transfert.emplacementDestinationId,
            quantiteMilli: recue,
            documentType: 'TRANSFERT',
            documentNumero: numeroReception,
            motif: transfert.motif ?? undefined,
            utilisateurId: params.utilisateurId,
          }, tx);
        }

        if (ecart !== 0) {
          avecEcart = true;
          // L'ecart solde le reste du transit : un manquant sort des
          // comptes du magasin expediteur, qui a laisse partir la
          // marchandise ; un excedent y rentre.
          await this.stocks.appliquer({
            type: TypeMouvement.TRANSFERT_ECART,
            articleId: ligne.articleId,
            emplacementId: transitId,
            quantiteMilli: ecart,
            documentType: 'TRANSFERT',
            documentNumero: numeroReception,
            motif: compte?.motifEcart
              ?? (ecart < 0 ? 'Manquant a la reception' : 'Excedent a la reception'),
            utilisateurId: params.utilisateurId,
            // Un manquant creuse le transit : c'est precisement ce
            // qu'on veut voir, pas ce qu'on veut interdire.
            autoriserNegatif: true,
          }, tx);
        }

        await tx.ligneTransfertStock.update({
          where: { id: ligne.id },
          data: {
            quantiteRecueMilli: recue,
            motifEcart: ecart !== 0 ? (compte?.motifEcart ?? null) : null,
          },
        });
      }

      const maj = await tx.transfertStock.update({
        where: { id: params.id },
        data: {
          statut: StatutTransfertStock.RECU,
          numeroReception,
          recuParId: params.utilisateurId,
          recuLe: new Date(),
          avecEcart,
          commentaireReception: params.commentaire,
        },
        include: this.inclusions(),
      });

      await this.audit.journaliser({
        utilisateurId: params.utilisateurId,
        action: 'transfert.recu',
        entite: 'TransfertStock',
        entiteId: params.id,
        details: {
          numero: transfert.numero,
          numeroReception,
          avecEcart,
          ecarts: maj.lignes
            .filter((l) => (l.quantiteRecueMilli ?? 0) !== l.quantiteMilli)
            .map((l) => ({
              articleId: l.articleId,
              expedieMilli: l.quantiteMilli,
              recuMilli: l.quantiteRecueMilli,
            })),
        },
      });

      return this.enSortie(maj);
    });
  }

  /**
   * Annule un bon.
   *
   * Avant l'expedition, rien n'a bouge : le bon disparait simplement de
   * la liste des bons a expedier. Apres l'expedition, la marchandise est
   * sur la route ; l'annuler la ramene au rayon de depart, ce qui n'a de
   * sens que si le camion fait demi-tour. Un bon deja recu ne s'annule
   * pas : on corrigerait par un transfert en sens inverse.
   */
  async annuler(id: string, motif: string, utilisateurId: string) {
    return this.prisma.$transaction(async (tx) => {
      const transfert = await tx.transfertStock.findUnique({
        where: { id },
        include: { lignes: true },
      });
      if (!transfert) throw new NotFoundException('Transfert introuvable');
      if (transfert.statut === StatutTransfertStock.RECU) {
        throw new BadRequestException(
          'Un bon deja receptionne ne s’annule pas : la marchandise est en rayon. '
          + 'Faites un transfert en sens inverse.',
        );
      }
      if (transfert.statut === StatutTransfertStock.ANNULE) {
        throw new BadRequestException('Ce bon est deja annule');
      }

      if (transfert.statut === StatutTransfertStock.EXPEDIE) {
        const transitId = await this.transitDe(transfert.magasinSourceId, tx);
        for (const ligne of transfert.lignes) {
          await this.stocks.appliquer({
            type: TypeMouvement.TRANSFERT_SORTIE,
            articleId: ligne.articleId,
            emplacementId: transitId,
            quantiteMilli: -ligne.quantiteMilli,
            documentType: 'TRANSFERT',
            documentNumero: transfert.numero,
            motif: 'Retour : transfert annule',
            utilisateurId,
          }, tx);
          await this.stocks.appliquer({
            type: TypeMouvement.TRANSFERT_ENTREE,
            articleId: ligne.articleId,
            emplacementId: transfert.emplacementSourceId,
            quantiteMilli: ligne.quantiteMilli,
            documentType: 'TRANSFERT',
            documentNumero: transfert.numero,
            motif: 'Retour : transfert annule',
            utilisateurId,
          }, tx);
        }
      }

      const maj = await tx.transfertStock.update({
        where: { id },
        data: { statut: StatutTransfertStock.ANNULE, motif },
        include: this.inclusions(),
      });

      await this.audit.journaliser({
        utilisateurId,
        action: 'transfert.annule',
        entite: 'TransfertStock',
        entiteId: id,
        details: { numero: transfert.numero, motif, etaitExpedie: transfert.statut === 'EXPEDIE' },
      });

      return this.enSortie(maj);
    });
  }

  /** Liste des transferts visibles par l'utilisateur. */
  async liste(params: { magasinIds: string[]; statut?: StatutTransfertStock; limite?: number }) {
    const transferts = await this.prisma.transfertStock.findMany({
      where: {
        OR: [
          { magasinSourceId: { in: params.magasinIds } },
          { magasinDestinationId: { in: params.magasinIds } },
        ],
        ...(params.statut ? { statut: params.statut } : {}),
      },
      orderBy: { creeLe: 'desc' },
      take: Math.min(params.limite ?? 100, 500),
      include: this.inclusions(),
    });
    return transferts.map((t) => this.enSortie(t));
  }

  async parId(id: string, magasinIds: string[]) {
    const transfert = await this.prisma.transfertStock.findUnique({
      where: { id },
      include: this.inclusions(),
    });
    if (!transfert) throw new NotFoundException('Transfert introuvable');
    if (
      !magasinIds.includes(transfert.magasinSourceId)
      && !magasinIds.includes(transfert.magasinDestinationId)
    ) {
      throw new NotFoundException('Transfert introuvable');
    }
    return this.enSortie(transfert);
  }

  /**
   * Marchandise encore sur la route.
   *
   * Un transfert expedie et jamais receptionne est de l'argent qui
   * n'est nulle part : ce rapport le rend visible, avec son anciennete.
   */
  async enTransit(magasinIds: string[]) {
    const transferts = await this.prisma.transfertStock.findMany({
      where: {
        statut: StatutTransfertStock.EXPEDIE,
        OR: [
          { magasinSourceId: { in: magasinIds } },
          { magasinDestinationId: { in: magasinIds } },
        ],
      },
      orderBy: { expedieLe: 'asc' },
      include: this.inclusions(),
    });

    const maintenant = Date.now();
    return transferts.map((t) => {
      const sortie = this.enSortie(t);
      const depuis = t.expedieLe ? t.expedieLe.getTime() : maintenant;
      return {
        ...sortie,
        joursEnTransit: Math.floor((maintenant - depuis) / 86400000),
      };
    });
  }

  private inclusions() {
    return {
      magasinSource: { select: { code: true, nom: true } },
      magasinDestination: { select: { code: true, nom: true } },
      emplacementSource: { select: { code: true, nom: true } },
      emplacementDestination: { select: { code: true, nom: true } },
      creePar: { select: { code: true, nom: true } },
      expediePar: { select: { code: true, nom: true } },
      recuPar: { select: { code: true, nom: true } },
      lignes: {
        include: {
          article: { select: { reference: true, designation: true, unite: true } },
        },
        orderBy: { id: 'asc' as const },
      },
    };
  }

  /** Ajoute la valeur et les ecarts, calcules une seule fois ici. */
  private enSortie(t: any) {
    const lignes = t.lignes.map((l: any) => {
      const recue = l.quantiteRecueMilli;
      const ecart = recue === null ? null : recue - l.quantiteMilli;
      return {
        ...l,
        cumpCentimes: c(l.cumpCentimes),
        ecartMilli: ecart,
        valeurExpedieeCentimes: Math.round((l.quantiteMilli * c(l.cumpCentimes)) / 1000),
        valeurEcartCentimes: ecart === null
          ? null
          : Math.round((ecart * c(l.cumpCentimes)) / 1000),
      };
    });

    return {
      ...t,
      lignes,
      valeurExpedieeCentimes: lignes.reduce(
        (total: number, l: any) => total + l.valeurExpedieeCentimes, 0,
      ),
      valeurEcartCentimes: lignes.reduce(
        (total: number, l: any) => total + (l.valeurEcartCentimes ?? 0), 0,
      ),
    };
  }

  private enClair(statut: StatutTransfertStock): string {
    switch (statut) {
      case StatutTransfertStock.PREPARE: return 'en preparation';
      case StatutTransfertStock.EXPEDIE: return 'expedie';
      case StatutTransfertStock.RECU: return 'receptionne';
      case StatutTransfertStock.ANNULE: return 'annule';
      default: return statut;
    }
  }
}
