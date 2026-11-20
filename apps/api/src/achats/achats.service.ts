import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CategorieOperation, ModeReglementAchat, SensMouvementTiers, SensOperation,
  StatutCommande, StatutReception, TypeMouvement, TypeReception,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumerotationService } from '../commun/numerotation.service';
import { AuditService } from '../audit/audit.service';
import { StocksService } from '../stocks/stocks.service';
import { TiersService } from '../tiers/tiers.service';
import { TresorerieService } from '../tresorerie/tresorerie.service';
import { b, c } from '../commun/bigint';
import { totauxDocument, prixVenteDepuisMarge, type LigneTarifee } from '@gestglobale/shared';

export interface LigneReceptionEntree {
  articleId: string;
  quantiteMilli: number;
  prixAchatCentimes: number;
  remisePourcent?: number;
  tauxTva?: number;
  lotNumero?: string;
  datePeremption?: string;
  /** Prix de vente a appliquer apres la reception, si le gerant le decide. */
  prixVenteAppliqueCentimes?: number;
}

@Injectable()
export class AchatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numerotation: NumerotationService,
    private readonly audit: AuditService,
    private readonly stocks: StocksService,
    private readonly tiers: TiersService,
    private readonly tresorerie: TresorerieService,
  ) {}

  /** Bon de commande fournisseur (M3). */
  async creerCommande(params: {
    fournisseurId: string;
    magasinId: string;
    dateLivraisonPrevue?: string;
    observation?: string;
    lignes: Array<{
      articleId: string;
      quantiteMilli: number;
      prixAchatCentimes: number;
      remisePourcent?: number;
      tauxTva?: number;
    }>;
    utilisateurId: string;
  }) {
    if (params.lignes.length === 0) {
      throw new BadRequestException('Une commande comporte au moins une ligne');
    }
    const numero = await this.numerotation.suivant('CMD');
    const totaux = this.calculerTotaux(params.lignes);

    const commande = await this.prisma.commandeFournisseur.create({
      data: {
        numero,
        fournisseurId: params.fournisseurId,
        magasinId: params.magasinId,
        dateLivraisonPrevue: params.dateLivraisonPrevue
          ? new Date(params.dateLivraisonPrevue)
          : null,
        observation: params.observation,
        utilisateurId: params.utilisateurId,
        totalHtCentimes: b(totaux.totalHtCentimes),
        totalTvaCentimes: b(totaux.totalTvaCentimes),
        totalTtcCentimes: b(totaux.totalTtcCentimes),
        lignes: {
          create: params.lignes.map((l) => ({
            articleId: l.articleId,
            quantiteMilli: l.quantiteMilli,
            prixAchatCentimes: b(l.prixAchatCentimes),
            remisePourcent: l.remisePourcent ?? 0,
            tauxTva: l.tauxTva ?? 0,
            totalHtCentimes: b(
              Math.round(
                (l.quantiteMilli * l.prixAchatCentimes * (1 - (l.remisePourcent ?? 0) / 100)) / 1000,
              ),
            ),
          })),
        },
      },
      include: { lignes: true, fournisseur: true },
    });

    await this.audit.journaliser({
      utilisateurId: params.utilisateurId,
      action: 'achat.commande_creee',
      entite: 'CommandeFournisseur',
      entiteId: commande.id,
      magasinId: params.magasinId,
      details: { numero, totalTtcCentimes: totaux.totalTtcCentimes },
    });
    return commande;
  }

  private calculerTotaux(
    lignes: Array<{
      quantiteMilli: number;
      prixAchatCentimes: number;
      remisePourcent?: number;
      tauxTva?: number;
    }>,
  ) {
    const tarifees: LigneTarifee[] = lignes.map((l) => ({
      quantiteMilli: l.quantiteMilli,
      prixUnitaireCentimes: l.prixAchatCentimes,
      remisePourcent: l.remisePourcent ?? 0,
      tauxTva: l.tauxTva ?? 0,
    }));
    return totauxDocument(tarifees);
  }

  /** Reception en brouillon : rien ne bouge en stock avant validation. */
  async creerReception(params: {
    fournisseurId: string;
    magasinId: string;
    emplacementId: string;
    commandeId?: string;
    numeroBonFournisseur?: string;
    type?: TypeReception;
    lignes: LigneReceptionEntree[];
    utilisateurId: string;
  }) {
    if (params.lignes.length === 0) {
      throw new BadRequestException('Une reception comporte au moins une ligne');
    }
    const prefixe = params.type === TypeReception.RETOUR ? 'RET' : 'RCP';
    const numero = await this.numerotation.suivant(prefixe);
    const totaux = this.calculerTotaux(params.lignes);

    // Prix de vente propose : conserve le taux de marge actuel de l'article
    // face au nouveau cout d'achat (M3).
    const articles = await this.prisma.article.findMany({
      where: { id: { in: params.lignes.map((l) => l.articleId) } },
      include: { prix: { where: { magasinId: null, categorie: 'DETAIL' } } },
    });
    const parId = new Map(articles.map((a) => [a.id, a]));

    const reception = await this.prisma.reception.create({
      data: {
        numero,
        type: params.type ?? TypeReception.RECEPTION,
        fournisseurId: params.fournisseurId,
        magasinId: params.magasinId,
        emplacementId: params.emplacementId,
        commandeId: params.commandeId,
        numeroBonFournisseur: params.numeroBonFournisseur,
        utilisateurId: params.utilisateurId,
        totalHtCentimes: b(totaux.totalHtCentimes),
        totalTvaCentimes: b(totaux.totalTvaCentimes),
        totalTtcCentimes: b(totaux.totalTtcCentimes),
        lignes: {
          create: params.lignes.map((l) => {
            const article = parId.get(l.articleId);
            const cumpActuel = c(article?.cumpCentimes);
            const prixActuel = c(article?.prix?.[0]?.prixCentimes);
            const margeActuelle =
              prixActuel > 0 ? ((prixActuel - cumpActuel) / prixActuel) * 100 : 0;
            const prixAchatNet = Math.round(
              l.prixAchatCentimes * (1 - (l.remisePourcent ?? 0) / 100),
            );
            const propose =
              margeActuelle > 0 && margeActuelle < 100
                ? prixVenteDepuisMarge(prixAchatNet, margeActuelle)
                : null;

            return {
              articleId: l.articleId,
              quantiteMilli: l.quantiteMilli,
              prixAchatCentimes: b(l.prixAchatCentimes),
              remisePourcent: l.remisePourcent ?? 0,
              tauxTva: l.tauxTva ?? 0,
              totalHtCentimes: b(Math.round((l.quantiteMilli * prixAchatNet) / 1000)),
              cumpAvantCentimes: b(cumpActuel),
              prixVenteProposeCentimes: propose !== null ? b(propose) : null,
              prixVenteAppliqueCentimes:
                l.prixVenteAppliqueCentimes !== undefined
                  ? b(l.prixVenteAppliqueCentimes)
                  : null,
              lotNumero: l.lotNumero,
              datePeremption: l.datePeremption ? new Date(l.datePeremption) : null,
            };
          }),
        },
      },
      include: { lignes: { include: { article: true } } },
    });

    return reception;
  }

  /**
   * Validation d'une reception : c'est ici, et seulement ici, que le stock
   * entre, que le CUMP est recalcule et que la dette fournisseur nait.
   * Tout se fait dans une transaction unique.
   */
  async validerReception(
    receptionId: string,
    options: {
      modeReglement?: ModeReglementAchat;
      compteId?: string;
      dateEcheance?: string;
      appliquerPrixVente?: boolean;
      utilisateurId: string;
    },
  ) {
    const reception = await this.prisma.reception.findUnique({
      where: { id: receptionId },
      include: { lignes: true, fournisseur: true },
    });
    if (!reception) throw new NotFoundException('Reception introuvable');
    if (reception.statut !== StatutReception.BROUILLON) {
      throw new BadRequestException(`Reception deja ${reception.statut.toLowerCase()}`);
    }

    const estRetour = reception.type === TypeReception.RETOUR;
    const modeReglement = options.modeReglement ?? ModeReglementAchat.CREDIT;
    if (modeReglement === ModeReglementAchat.COMPTANT && !options.compteId) {
      throw new BadRequestException(
        'Un achat au comptant exige le compte de tresorerie debite (tiroir ou banque)',
      );
    }

    const resultat = await this.prisma.$transaction(
      async (tx) => {
        for (const ligne of reception.lignes) {
          // Un lot n'est cree que si l'article le demande et qu'un numero
          // de lot est fourni.
          let lotId: string | null = null;
          if (ligne.lotNumero) {
            const lot = await tx.lot.upsert({
              where: {
                articleId_emplacementId_numero: {
                  articleId: ligne.articleId,
                  emplacementId: reception.emplacementId,
                  numero: ligne.lotNumero,
                },
              },
              create: {
                articleId: ligne.articleId,
                emplacementId: reception.emplacementId,
                numero: ligne.lotNumero,
                datePeremption: ligne.datePeremption,
                quantiteMilli: 0,
                receptionId: reception.id,
              },
              update: { datePeremption: ligne.datePeremption },
            });
            lotId = lot.id;
          }

          const prixNet = Math.round(
            c(ligne.prixAchatCentimes) * (1 - ligne.remisePourcent / 100),
          );

          const mouvement = await this.stocks.appliquer(
            {
              type: estRetour ? TypeMouvement.RETOUR_FOURNISSEUR : TypeMouvement.RECEPTION,
              articleId: ligne.articleId,
              emplacementId: reception.emplacementId,
              quantiteMilli: estRetour ? -ligne.quantiteMilli : ligne.quantiteMilli,
              prixAchatCentimes: estRetour ? undefined : prixNet,
              lotId,
              documentType: 'RECEPTION',
              documentId: reception.id,
              documentNumero: reception.numero,
              utilisateurId: options.utilisateurId,
            },
            tx,
          );

          await tx.ligneReception.update({
            where: { id: ligne.id },
            data: { cumpApresCentimes: b(mouvement.cumpCentimes) },
          });

          if (options.appliquerPrixVente) {
            const nouveauPrix =
              c(ligne.prixVenteAppliqueCentimes) || c(ligne.prixVenteProposeCentimes);
            if (nouveauPrix > 0) {
              const existant = await tx.prixArticle.findFirst({
                where: { articleId: ligne.articleId, magasinId: null, categorie: 'DETAIL' },
              });
              const ancien = c(existant?.prixCentimes);
              if (ancien !== nouveauPrix) {
                if (existant) {
                  await tx.prixArticle.update({
                    where: { id: existant.id },
                    data: { prixCentimes: b(nouveauPrix), actifDepuis: new Date() },
                  });
                } else {
                  await tx.prixArticle.create({
                    data: {
                      articleId: ligne.articleId,
                      magasinId: null,
                      categorie: 'DETAIL',
                      prixCentimes: b(nouveauPrix),
                    },
                  });
                }
                await tx.historiquePrix.create({
                  data: {
                    articleId: ligne.articleId,
                    categorie: 'DETAIL',
                    ancienPrixCentimes: b(ancien),
                    nouveauPrixCentimes: b(nouveauPrix),
                    motif: `Reception ${reception.numero}`,
                    utilisateurId: options.utilisateurId,
                  },
                });
              }
            }
          }

          if (reception.commandeId) {
            await tx.ligneCommande.updateMany({
              where: { commandeId: reception.commandeId, articleId: ligne.articleId },
              data: { quantiteRecueMilli: { increment: ligne.quantiteMilli } },
            });
          }
        }

        const totalTtc = c(reception.totalTtcCentimes);
        const numeroFacture = await this.numerotation.suivant('FA', { tx });

        await tx.factureAchat.create({
          data: {
            numero: numeroFacture,
            numeroFournisseur: reception.numeroBonFournisseur,
            fournisseurId: reception.fournisseurId,
            receptionId: reception.id,
            dateEcheance: options.dateEcheance ? new Date(options.dateEcheance) : null,
            modeReglement,
            totalHtCentimes: reception.totalHtCentimes,
            totalTvaCentimes: reception.totalTvaCentimes,
            totalTtcCentimes: reception.totalTtcCentimes,
            regleCentimes: modeReglement === ModeReglementAchat.COMPTANT
              ? reception.totalTtcCentimes
              : BigInt(0),
            utilisateurId: options.utilisateurId,
          },
        });

        if (modeReglement === ModeReglementAchat.COMPTANT) {
          // Paiement immediat : l'argent sort du tiroir ou de la banque,
          // le solde fournisseur reste inchange.
          await this.tresorerie.enregistrer(
            {
              compteId: options.compteId as string,
              sens: estRetour ? SensOperation.ENTREE : SensOperation.SORTIE,
              categorie: CategorieOperation.ACHAT_COMPTANT,
              montantCentimes: totalTtc,
              libelle: `${estRetour ? 'Retour' : 'Achat'} comptant ${reception.fournisseur.raisonSociale}`,
              tiersId: reception.fournisseurId,
              documentType: 'RECEPTION',
              documentNumero: reception.numero,
              utilisateurId: options.utilisateurId,
            },
            tx,
          );
        } else {
          // A credit : la dette fournisseur augmente (sens CREDIT du point
          // de vue du magasin : nous lui devons de l'argent).
          await this.tiers.enregistrerMouvement(
            {
              tiersId: reception.fournisseurId,
              sens: estRetour ? SensMouvementTiers.DEBIT : SensMouvementTiers.CREDIT,
              montantCentimes: totalTtc,
              categorie: estRetour ? 'RETOUR_FOURNISSEUR' : 'FACTURE_ACHAT',
              libelle: `${estRetour ? 'Retour' : 'Facture'} ${reception.numero}`,
              documentType: 'RECEPTION',
              documentId: reception.id,
              documentNumero: reception.numero,
              utilisateurId: options.utilisateurId,
            },
            tx,
          );

          if (options.dateEcheance && !estRetour) {
            await tx.echeance.create({
              data: {
                tiersId: reception.fournisseurId,
                documentNumero: numeroFacture,
                montantCentimes: reception.totalTtcCentimes,
                dateEcheance: new Date(options.dateEcheance),
              },
            });
          }
        }

        if (reception.commandeId) {
          const lignesCommande = await tx.ligneCommande.findMany({
            where: { commandeId: reception.commandeId },
          });
          const complete = lignesCommande.every((l) => l.quantiteRecueMilli >= l.quantiteMilli);
          await tx.commandeFournisseur.update({
            where: { id: reception.commandeId },
            data: { statut: complete ? StatutCommande.RECUE : StatutCommande.PARTIELLE },
          });
        }

        return tx.reception.update({
          where: { id: receptionId },
          data: { statut: StatutReception.VALIDEE, valideeLe: new Date() },
        });
      },
      { timeout: 120000 },
    );

    await this.audit.journaliser({
      utilisateurId: options.utilisateurId,
      action: estRetour ? 'achat.retour_valide' : 'achat.reception_validee',
      entite: 'Reception',
      entiteId: receptionId,
      magasinId: reception.magasinId,
      details: {
        numero: reception.numero,
        lignes: reception.lignes.length,
        totalTtcCentimes: c(reception.totalTtcCentimes),
        modeReglement,
      },
    });
    return resultat;
  }

  /** Reglement d'une facture fournisseur (M3, M7). */
  async reglerFacture(params: {
    factureId: string;
    compteId: string;
    montantCentimes: number;
    utilisateurId: string;
  }) {
    const facture = await this.prisma.factureAchat.findUnique({
      where: { id: params.factureId },
      include: { fournisseur: true },
    });
    if (!facture) throw new NotFoundException('Facture introuvable');

    const reste = c(facture.totalTtcCentimes) - c(facture.regleCentimes);
    if (params.montantCentimes > reste) {
      throw new BadRequestException(
        `Le reglement depasse le reste du : ${reste / 100} DA`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.tresorerie.enregistrer(
        {
          compteId: params.compteId,
          sens: SensOperation.SORTIE,
          categorie: CategorieOperation.PAIEMENT_FOURNISSEUR,
          montantCentimes: params.montantCentimes,
          libelle: `Reglement ${facture.numero} — ${facture.fournisseur.raisonSociale}`,
          tiersId: facture.fournisseurId,
          documentType: 'FACTURE_ACHAT',
          documentNumero: facture.numero,
          utilisateurId: params.utilisateurId,
        },
        tx,
      );
      await this.tiers.enregistrerMouvement(
        {
          tiersId: facture.fournisseurId,
          sens: SensMouvementTiers.DEBIT,
          montantCentimes: params.montantCentimes,
          categorie: 'PAIEMENT_FOURNISSEUR',
          libelle: `Reglement ${facture.numero}`,
          documentType: 'FACTURE_ACHAT',
          documentNumero: facture.numero,
          utilisateurId: params.utilisateurId,
        },
        tx,
      );
      await tx.factureAchat.update({
        where: { id: params.factureId },
        data: { regleCentimes: { increment: b(params.montantCentimes) } },
      });
      await tx.echeance.updateMany({
        where: { documentNumero: facture.numero, soldee: false },
        data: {
          regleCentimes: { increment: b(params.montantCentimes) },
          soldee: params.montantCentimes >= reste,
        },
      });
    });

    return { regle: params.montantCentimes, resteCentimes: reste - params.montantCentimes };
  }

  /** Comparaison des fournisseurs sur un meme article (M3). */
  async comparerFournisseurs(articleId: string) {
    const lignes = await this.prisma.$queryRaw<
      Array<{
        fournisseurId: string;
        raisonSociale: string;
        dernierPrixCentimes: bigint;
        prixMoyenCentimes: number;
        nombreReceptions: bigint;
        derniereReception: Date;
      }>
    >`
      SELECT t."id"             AS "fournisseurId",
             t."raisonSociale",
             (ARRAY_AGG(lr."prixAchatCentimes" ORDER BY r."dateReception" DESC))[1]
                                AS "dernierPrixCentimes",
             AVG(lr."prixAchatCentimes")::float8 AS "prixMoyenCentimes",
             COUNT(*)           AS "nombreReceptions",
             MAX(r."dateReception") AS "derniereReception"
        FROM "LigneReception" lr
        JOIN "Reception" r ON r."id" = lr."receptionId"
        JOIN "Tiers" t     ON t."id" = r."fournisseurId"
       WHERE lr."articleId" = ${articleId}
         AND r."statut" = 'VALIDEE'
       GROUP BY t."id", t."raisonSociale"
       ORDER BY "dernierPrixCentimes" ASC`;

    return lignes.map((l) => ({
      fournisseurId: l.fournisseurId,
      raisonSociale: l.raisonSociale,
      dernierPrixCentimes: c(l.dernierPrixCentimes),
      prixMoyenCentimes: Math.round(l.prixMoyenCentimes),
      nombreReceptions: Number(l.nombreReceptions),
      derniereReception: l.derniereReception,
    }));
  }
}
