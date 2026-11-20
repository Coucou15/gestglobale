import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CategorieOperation, ModePaiement, Prisma, SensMouvementTiers, SensOperation,
  StatutDocumentVente, StatutSession, TypeDocumentVente, TypeMouvement,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StocksService } from '../stocks/stocks.service';
import { TiersService } from '../tiers/tiers.service';
import { TresorerieService } from '../tresorerie/tresorerie.service';
import { b, c } from '../commun/bigint';
import { margeLigne, type TicketSync } from '@gestglobale/shared';

export interface ResultatEnregistrement {
  statut: 'ACCEPTE' | 'DEJA_RECU' | 'REFUSE';
  numero: string;
  documentId?: string;
  erreur?: string;
}

/**
 * Enregistrement d'un ticket au serveur central.
 *
 * Le meme chemin sert a un ticket ne en ligne et a un ticket remonte apres
 * une coupure : c'est voulu, pour qu'un ticket hors ligne subisse exactement
 * les memes controles et produise exactement les memes ecritures.
 */
@Injectable()
export class VentesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly stocks: StocksService,
    private readonly tiers: TiersService,
    private readonly tresorerie: TresorerieService,
  ) {}

  /**
   * Enregistre un ticket de maniere idempotente.
   *
   * Le numero est attribue par la caisse (SV-03-000125) et porte une
   * contrainte d'unicite en base : un meme ticket renvoye deux fois apres
   * un accuse perdu est reconnu et non redouble. C'est la garantie exigee
   * par le critere de reception "100 % des tickets, sans doublon".
   */
  async enregistrerTicket(
    ticket: TicketSync,
    contexte: { magasinId: string; caisseId: string },
  ): Promise<ResultatEnregistrement> {
    const existant = await this.prisma.documentVente.findUnique({
      where: { numero: ticket.numero },
      select: { id: true },
    });
    if (existant) {
      return { statut: 'DEJA_RECU', numero: ticket.numero, documentId: existant.id };
    }

    try {
      const document = await this.prisma.$transaction(
        (tx) => this.ecrireTicket(tx, ticket, contexte),
        { timeout: 60000 },
      );
      return { statut: 'ACCEPTE', numero: ticket.numero, documentId: document.id };
    } catch (erreur) {
      // Une violation d'unicite signifie qu'un envoi concurrent a gagne la
      // course : le ticket est bien enregistre, l'accuse doit le dire.
      if (
        erreur instanceof Prisma.PrismaClientKnownRequestError &&
        erreur.code === 'P2002'
      ) {
        const doublon = await this.prisma.documentVente.findUnique({
          where: { numero: ticket.numero },
          select: { id: true },
        });
        if (doublon) {
          return { statut: 'DEJA_RECU', numero: ticket.numero, documentId: doublon.id };
        }
      }
      return {
        statut: 'REFUSE',
        numero: ticket.numero,
        erreur: erreur instanceof Error ? erreur.message : String(erreur),
      };
    }
  }

  private async ecrireTicket(
    tx: Prisma.TransactionClient,
    ticket: TicketSync,
    contexte: { magasinId: string; caisseId: string },
  ) {
    const session = await tx.sessionCaisse.findUnique({
      where: { numero: ticket.sessionCaisseNumero },
      select: { id: true, caisseId: true },
    });
    if (!session) {
      throw new NotFoundException(
        `Session de caisse inconnue : ${ticket.sessionCaisseNumero}`,
      );
    }

    const emplacement = await tx.emplacement.findFirst({
      where: { magasinId: contexte.magasinId, parDefautVente: true },
      select: { id: true },
    });
    if (!emplacement) {
      throw new BadRequestException(
        'Aucun emplacement de vente par defaut defini pour ce magasin',
      );
    }

    const estRetour = ticket.type === 'RETOUR';
    const signe = estRetour ? 1 : -1;

    const document = await tx.documentVente.create({
      data: {
        numero: ticket.numero,
        type: estRetour ? TypeDocumentVente.RETOUR : TypeDocumentVente.TICKET,
        statut:
          ticket.type === 'ANNULATION' ? StatutDocumentVente.ANNULE : StatutDocumentVente.VALIDE,
        magasinId: contexte.magasinId,
        caisseId: contexte.caisseId,
        sessionId: session.id,
        clientId: ticket.clientId,
        utilisateurId: ticket.utilisateurId,
        dateVente: new Date(ticket.dateVente),
        totalHtCentimes: b(ticket.totalHtCentimes),
        totalTvaCentimes: b(ticket.totalTvaCentimes),
        timbreCentimes: b(ticket.timbreCentimes),
        totalTtcCentimes: b(ticket.totalTtcCentimes),
        remisePiedCentimes: b(ticket.remisePiedCentimes),
        renduCentimes: b(ticket.renduCentimes),
        horsLigne: ticket.horsLigne,
        prixPerime: ticket.prixPerime,
        forcageSuperviseurId: ticket.forcageSuperviseurId,
        recuLe: new Date(),
      },
    });

    let margeTotale = 0;

    // Les sorties de stock sont collectees ici puis appliquees en bloc,
    // triees par article. Deux tickets concurrents qui portent les memes
    // articles dans un ordre de lignes different verrouilleraient sinon
    // les memes lignes de stock en ordre inverse, situation dont
    // PostgreSQL ne sort qu'en abattant l'une des deux transactions. Le
    // ticket serait refuse alors qu'il est deja encaisse.
    //
    // Je n'ai pas reussi a provoquer l'interblocage sur 122 tickets
    // concurrents ; l'ordre deterministe le rend simplement impossible,
    // et il ne coute rien.
    const sortiesStock: Array<{ articleId: string; quantiteMilli: number }> = [];

    for (const ligne of ticket.lignes) {
      if (ligne.annulee) {
        // Une ligne annulee est conservee pour l'audit mais ne sort pas
        // de stock et n'entre pas dans la marge.
        await tx.ligneVente.create({
          data: this.donneesLigne(document.id, ligne, 0),
        });
        continue;
      }

      const article = await tx.article.findUnique({
        where: { id: ligne.articleId },
        select: { id: true, packDeId: true, packNbUnites: true, cumpCentimes: true },
      });
      if (!article) throw new NotFoundException(`Article inconnu : ${ligne.articleId}`);

      // Un pack decremente N unites de son article de base (M1).
      const articleStockId = article.packDeId ?? article.id;
      const facteur = article.packDeId ? (article.packNbUnites ?? 1) : 1;
      const quantiteStock = ligne.quantiteMilli * facteur;

      const marge = margeLigne({
        quantiteMilli: ligne.quantiteMilli,
        prixVenteCentimes: ligne.prixUnitaireCentimes,
        cumpCentimes: ligne.cumpCentimes,
      });
      margeTotale += estRetour ? -marge.margeCentimes : marge.margeCentimes;

      await tx.ligneVente.create({
        data: {
          ...this.donneesLigne(document.id, ligne, marge.margeCentimes),
          unitesStockMilli: quantiteStock,
        },
      });

      sortiesStock.push({
        articleId: articleStockId,
        quantiteMilli: signe * quantiteStock,
      });
    }

    sortiesStock.sort((a, b) => (a.articleId < b.articleId ? -1 : a.articleId > b.articleId ? 1 : 0));

    for (const sortie of sortiesStock) {
      await this.stocks.appliquer(
        {
          type: estRetour ? TypeMouvement.RETOUR_CLIENT : TypeMouvement.VENTE,
          articleId: sortie.articleId,
          emplacementId: emplacement.id,
          quantiteMilli: sortie.quantiteMilli,
          documentType: 'TICKET',
          documentId: document.id,
          documentNumero: ticket.numero,
          utilisateurId: ticket.utilisateurId,
          caisseId: contexte.caisseId,
          date: new Date(ticket.dateVente),
          // Un ticket encaisse ne se refuse pas : le client est parti avec
          // la marchandise. Le stock passe en negatif et le rapport des
          // stocks negatifs le signale pour correction par inventaire.
          autoriserNegatif: true,
        },
        tx,
      );
    }

    const compteTiroir = await tx.compteTresorerie.findUnique({
      where: { caisseId: contexte.caisseId },
      select: { id: true },
    });

    for (const reglement of ticket.reglements) {
      await tx.reglement.create({
        data: {
          documentId: document.id,
          mode: reglement.mode as ModePaiement,
          montantCentimes: b(reglement.montantCentimes),
          reference: reglement.reference,
          compteId: reglement.mode === 'ESPECES' ? compteTiroir?.id : null,
        },
      });

      if (reglement.mode === 'CREDIT') {
        if (!ticket.clientId) {
          throw new BadRequestException('Un reglement a credit exige un client identifie');
        }
        // La dette du client augmente ; un retour la diminue.
        await this.tiers.enregistrerMouvement(
          {
            tiersId: ticket.clientId,
            sens: estRetour ? SensMouvementTiers.CREDIT : SensMouvementTiers.DEBIT,
            montantCentimes: reglement.montantCentimes,
            categorie: estRetour ? 'AVOIR' : 'VENTE_CREDIT',
            libelle: `Ticket ${ticket.numero}`,
            documentType: 'TICKET',
            documentId: document.id,
            documentNumero: ticket.numero,
            utilisateurId: ticket.utilisateurId,
            date: new Date(ticket.dateVente),
          },
          tx,
        );
      } else if (reglement.mode === 'ESPECES' && compteTiroir) {
        await this.tresorerie.enregistrer(
          {
            compteId: compteTiroir.id,
            sens: estRetour ? SensOperation.SORTIE : SensOperation.ENTREE,
            categorie: CategorieOperation.VENTE_COMPTANT,
            montantCentimes: reglement.montantCentimes,
            libelle: `Ticket ${ticket.numero}`,
            documentType: 'TICKET',
            documentNumero: ticket.numero,
            utilisateurId: ticket.utilisateurId,
            date: new Date(ticket.dateVente),
            // Un encaissement ou un rendu deja effectue en caisse ne se
            // refuse pas : l'argent a change de mains.
            autoriserNegatif: true,
          },
          tx,
        );
      }
    }

    return tx.documentVente.update({
      where: { id: document.id },
      data: { margeCentimes: b(margeTotale) },
    });
  }

  private donneesLigne(
    documentId: string,
    ligne: TicketSync['lignes'][number],
    margeCentimes: number,
  ) {
    return {
      documentId,
      numeroLigne: ligne.numeroLigne,
      articleId: ligne.articleId,
      codeScanne: ligne.codeScanne,
      designation: ligne.designation,
      quantiteMilli: ligne.quantiteMilli,
      prixUnitaireCentimes: b(ligne.prixUnitaireCentimes),
      remisePourcent: ligne.remisePourcent,
      remiseCentimes: b(ligne.remiseCentimes),
      tauxTva: ligne.tauxTva,
      totalHtCentimes: b(ligne.totalHtCentimes),
      totalTvaCentimes: b(ligne.totalTtcCentimes - ligne.totalHtCentimes),
      totalTtcCentimes: b(ligne.totalTtcCentimes),
      cumpCentimes: b(ligne.cumpCentimes),
      margeCentimes: b(margeCentimes),
      annulee: ligne.annulee,
      autoriseeParId: ligne.autoriseeParUtilisateurId,
      promotionId: ligne.promotionId,
    };
  }

  /** Annulation d'un ticket deja enregistre : contre-ecriture complete. */
  async annulerTicket(numero: string, motif: string, utilisateurId: string) {
    const document = await this.prisma.documentVente.findUnique({
      where: { numero },
      include: { lignes: true, reglements: true },
    });
    if (!document) throw new NotFoundException('Ticket introuvable');
    if (document.statut === StatutDocumentVente.ANNULE) {
      throw new ConflictException('Ticket deja annule');
    }

    const emplacement = await this.prisma.emplacement.findFirst({
      where: { magasinId: document.magasinId, parDefautVente: true },
      select: { id: true },
    });
    if (!emplacement) throw new BadRequestException('Emplacement de vente introuvable');

    await this.prisma.$transaction(async (tx) => {
      for (const ligne of document.lignes) {
        if (ligne.annulee) continue;
        await this.stocks.appliquer(
          {
            type: TypeMouvement.RETOUR_CLIENT,
            articleId: ligne.articleId,
            emplacementId: emplacement.id,
            quantiteMilli: ligne.unitesStockMilli ?? ligne.quantiteMilli,
            documentType: 'ANNULATION',
            documentId: document.id,
            documentNumero: numero,
            motif: `Annulation ${numero} : ${motif}`,
            utilisateurId,
          },
          tx,
        );
      }

      const credit = document.reglements.find((r) => r.mode === ModePaiement.CREDIT);
      if (credit && document.clientId) {
        await this.tiers.enregistrerMouvement(
          {
            tiersId: document.clientId,
            sens: SensMouvementTiers.CREDIT,
            montantCentimes: c(credit.montantCentimes),
            categorie: 'ANNULATION',
            libelle: `Annulation ${numero}`,
            documentNumero: numero,
            utilisateurId,
          },
          tx,
        );
      }

      const especes = document.reglements.find((r) => r.mode === ModePaiement.ESPECES);
      if (especes?.compteId) {
        await this.tresorerie.enregistrer(
          {
            compteId: especes.compteId,
            sens: SensOperation.SORTIE,
            categorie: CategorieOperation.VENTE_COMPTANT,
            montantCentimes: c(especes.montantCentimes),
            libelle: `Annulation ${numero}`,
            documentNumero: numero,
            utilisateurId,
          },
          tx,
        );
      }

      await tx.documentVente.update({
        where: { id: document.id },
        data: { statut: StatutDocumentVente.ANNULE, motifAnnulation: motif },
      });
    });

    await this.audit.journaliser({
      utilisateurId,
      action: 'vente.ticket_annule',
      entite: 'DocumentVente',
      entiteId: document.id,
      magasinId: document.magasinId,
      details: { numero, motif, totalTtcCentimes: c(document.totalTtcCentimes) },
    });

    return { annule: true, numero };
  }

  /** Consultation des ventes du jour, pour le gerant depuis son telephone. */
  async ventesDuJour(magasinIds: string[], date = new Date()) {
    const debut = new Date(date);
    debut.setHours(0, 0, 0, 0);
    const fin = new Date(debut);
    fin.setDate(fin.getDate() + 1);

    const where = {
      magasinId: { in: magasinIds },
      dateVente: { gte: debut, lt: fin },
      statut: StatutDocumentVente.VALIDE,
    };

    const [totaux, parCaisse, parMode] = await Promise.all([
      this.prisma.documentVente.aggregate({
        where,
        _sum: { totalTtcCentimes: true, totalHtCentimes: true, margeCentimes: true },
        _count: true,
      }),
      this.prisma.documentVente.groupBy({
        by: ['caisseId'],
        where,
        _sum: { totalTtcCentimes: true },
        _count: true,
      }),
      this.prisma.reglement.groupBy({
        by: ['mode'],
        where: { document: where },
        _sum: { montantCentimes: true },
      }),
    ]);

    const nombre = totaux._count;
    const ca = c(totaux._sum.totalTtcCentimes);

    return {
      date: debut,
      nombreTickets: nombre,
      chiffreAffairesTtcCentimes: ca,
      chiffreAffairesHtCentimes: c(totaux._sum.totalHtCentimes),
      margeCentimes: c(totaux._sum.margeCentimes),
      panierMoyenCentimes: nombre > 0 ? Math.round(ca / nombre) : 0,
      parCaisse: parCaisse.map((p) => ({
        caisseId: p.caisseId,
        nombreTickets: p._count,
        totalTtcCentimes: c(p._sum.totalTtcCentimes),
      })),
      parModePaiement: parMode.map((p) => ({
        mode: p.mode,
        montantCentimes: c(p._sum.montantCentimes),
      })),
    };
  }
}
