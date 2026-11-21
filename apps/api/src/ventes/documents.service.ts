import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import {
  CategorieOperation, CategoriePrix, ModePaiement, Prisma, SensMouvementTiers, SensOperation,
  StatutDocumentVente, TypeDocumentVente, TypeMouvement,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumerotationService } from '../commun/numerotation.service';
import { AuditService } from '../audit/audit.service';
import { StocksService } from '../stocks/stocks.service';
import { TiersService } from '../tiers/tiers.service';
import { TresorerieService } from '../tresorerie/tresorerie.service';
import { b, c } from '../commun/bigint';
import {
  totauxDocument, margeLigne, TIMBRE_DEFAUT,
  type LigneTarifee, type ParametrageTimbre,
} from '@gestglobale/shared';

/**
 * Documents de vente etablis au back-office (M5).
 *
 * Distincts des tickets de caisse, qui naissent sur la caisse et portent
 * son numero. Ceux-ci sont des documents a valeur legale : leur
 * numerotation est sans trou, leurs mentions sont figees a l'emission, et
 * ils ne se modifient plus une fois valides.
 */

/** Prefixe de numerotation par type de document. */
const PREFIXES: Record<TypeDocumentVente, string> = {
  [TypeDocumentVente.FACTURE]: 'FA',
  [TypeDocumentVente.BON_LIVRAISON]: 'BL',
  [TypeDocumentVente.PROFORMA]: 'PF',
  [TypeDocumentVente.AVOIR]: 'AV',
  [TypeDocumentVente.RETOUR]: 'RT',
  [TypeDocumentVente.TICKET]: 'TK',
};

/** Types qui sortent la marchandise du stock. */
const LIVRENT: TypeDocumentVente[] = [
  TypeDocumentVente.BON_LIVRAISON,
  TypeDocumentVente.FACTURE,
];

/** Types qui font rentrer la marchandise. */
const REPRENNENT: TypeDocumentVente[] = [
  TypeDocumentVente.AVOIR,
  TypeDocumentVente.RETOUR,
];

export interface LigneDemandee {
  articleId: string;
  quantiteMilli: number;
  /** Prix impose ; sinon le tarif de la categorie du client s'applique. */
  prixUnitaireCentimes?: number;
  remisePourcent?: number;
}

export interface MentionsLegales {
  emetteur: {
    raisonSociale: string; adresse: string | null; telephone: string | null;
    rc: string | null; nif: string | null; nis: string | null; articleImposition: string | null;
  };
  destinataire: {
    code: string; raisonSociale: string; adresse: string | null; telephone: string | null;
    rc: string | null; nif: string | null; nis: string | null; articleImposition: string | null;
  } | null;
  emisLe: string;
}

@Injectable()
export class DocumentsVenteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numerotation: NumerotationService,
    private readonly audit: AuditService,
    private readonly stocks: StocksService,
    private readonly tiers: TiersService,
    private readonly tresorerie: TresorerieService,
  ) {}

  /** Parametrage du droit de timbre pour ce magasin. */
  private async timbre(magasinId: string): Promise<ParametrageTimbre> {
    const parametre =
      (await this.prisma.parametre.findFirst({ where: { cle: 'caisse.timbre', magasinId } })) ??
      (await this.prisma.parametre.findFirst({ where: { cle: 'caisse.timbre', magasinId: null } }));
    if (!parametre) return TIMBRE_DEFAUT;
    return { ...TIMBRE_DEFAUT, ...(parametre.valeur as object) } as ParametrageTimbre;
  }

  /**
   * Prix applicable a un article pour un client.
   * Le prix defini pour le magasin prime sur celui du siege (M11).
   */
  private prixApplicable(
    prix: Array<{ magasinId: string | null; categorie: CategoriePrix; prixCentimes: bigint }>,
    magasinId: string,
    categorie: CategoriePrix,
  ): number {
    const choisir = (cat: CategoriePrix) =>
      prix.find((p) => p.magasinId === magasinId && p.categorie === cat) ??
      prix.find((p) => p.magasinId === null && p.categorie === cat);
    const retenu = choisir(categorie) ?? choisir(CategoriePrix.DETAIL);
    return retenu ? c(retenu.prixCentimes) : 0;
  }

  /**
   * Cree un document en brouillon. Rien ne bouge : ni stock, ni compte,
   * ni numerotation definitive. Le brouillon se corrige librement.
   */
  async creer(params: {
    type: TypeDocumentVente;
    magasinId: string;
    clientId?: string | null;
    lignes: LigneDemandee[];
    remisePiedPourcent?: number;
    modePaiement?: ModePaiement;
    dateEcheance?: string;
    observation?: string;
    documentSourceId?: string;
    utilisateurId: string;
  }) {
    if (params.type === TypeDocumentVente.TICKET) {
      throw new BadRequestException(
        'Un ticket naît en caisse et porte son numero : il ne se cree pas ici',
      );
    }
    if (params.lignes.length === 0) {
      throw new BadRequestException('Un document comporte au moins une ligne');
    }
    // Une facture engage fiscalement : elle exige un client identifie,
    // avec ses mentions legales (section 8, conformite).
    if (params.type === TypeDocumentVente.FACTURE && !params.clientId) {
      throw new BadRequestException(
        'Une facture exige un client identifie, avec son RC, son NIF et son NIS',
      );
    }

    const client = params.clientId
      ? await this.prisma.tiers.findUniqueOrThrow({ where: { id: params.clientId } })
      : null;

    const articles = await this.prisma.article.findMany({
      where: { id: { in: params.lignes.map((l) => l.articleId) } },
      include: { prix: true },
    });
    const parId = new Map(articles.map((a) => [a.id, a]));

    const lignes = params.lignes.map((demande, index) => {
      const article = parId.get(demande.articleId);
      if (!article) throw new NotFoundException(`Article inconnu : ${demande.articleId}`);
      if (demande.quantiteMilli <= 0) {
        throw new BadRequestException(`Quantite invalide pour ${article.designation}`);
      }
      const prix =
        demande.prixUnitaireCentimes ??
        this.prixApplicable(
          article.prix, params.magasinId, client?.categoriePrix ?? CategoriePrix.DETAIL,
        );
      if (prix <= 0) {
        throw new BadRequestException(
          `${article.reference} — ${article.designation} n'a pas de prix : ` +
            'renseignez-le avant de l’inscrire sur un document',
        );
      }
      return {
        numeroLigne: index + 1,
        article,
        quantiteMilli: demande.quantiteMilli,
        prixUnitaireCentimes: prix,
        // La remise du client s'applique par defaut, ligne par ligne.
        remisePourcent: demande.remisePourcent ?? client?.remisePourcent ?? 0,
      };
    });

    const tarifees: LigneTarifee[] = lignes.map((l) => ({
      quantiteMilli: l.quantiteMilli,
      prixUnitaireCentimes: l.prixUnitaireCentimes,
      remisePourcent: l.remisePourcent,
      tauxTva: l.article.tauxTva,
    }));

    const totaux = totauxDocument(tarifees, {
      remisePiedPourcent: params.remisePiedPourcent,
      modesPaiement: params.modePaiement ? [params.modePaiement] : [],
      timbre: await this.timbre(params.magasinId),
    });

    // Numero provisoire : le numero definitif, sans trou, n'est attribue
    // qu'a la validation. Un brouillon abandonne ne doit pas creuser un
    // trou dans une serie a valeur legale.
    const numeroProvisoire = `${PREFIXES[params.type]}-BROUILLON-${Date.now()}`;

    const document = await this.prisma.documentVente.create({
      data: {
        numero: numeroProvisoire,
        type: params.type,
        brouillon: true,
        magasinId: params.magasinId,
        clientId: params.clientId ?? null,
        utilisateurId: params.utilisateurId,
        dateEcheance: params.dateEcheance ? new Date(params.dateEcheance) : null,
        observation: params.observation,
        documentSourceId: params.documentSourceId,
        remisePiedCentimes: b(
          params.remisePiedPourcent
            ? totaux.remiseCentimes -
                tarifees.reduce((t, l) => {
                  const brut = Math.round((l.quantiteMilli * l.prixUnitaireCentimes) / 1000);
                  return t + Math.round((brut * (l.remisePourcent ?? 0)) / 100);
                }, 0)
            : 0,
        ),
        totalBrutCentimes: b(totaux.brutCentimes),
        totalRemiseCentimes: b(totaux.remiseCentimes),
        totalHtCentimes: b(totaux.totalHtCentimes),
        totalTvaCentimes: b(totaux.totalTvaCentimes),
        timbreCentimes: b(totaux.timbreCentimes),
        totalTtcCentimes: b(totaux.totalTtcCentimes),
        lignes: {
          create: lignes.map((l) => {
            const t = totauxDocument([
              {
                quantiteMilli: l.quantiteMilli,
                prixUnitaireCentimes: l.prixUnitaireCentimes,
                remisePourcent: l.remisePourcent,
                tauxTva: l.article.tauxTva,
              },
            ]);
            const marge = margeLigne({
              quantiteMilli: l.quantiteMilli,
              prixVenteCentimes: l.prixUnitaireCentimes,
              cumpCentimes: c(l.article.cumpCentimes),
            });
            return {
              numeroLigne: l.numeroLigne,
              articleId: l.article.id,
              designation: l.article.designation,
              quantiteMilli: l.quantiteMilli,
              prixUnitaireCentimes: b(l.prixUnitaireCentimes),
              remisePourcent: l.remisePourcent,
              remiseCentimes: b(t.remiseCentimes),
              tauxTva: l.article.tauxTva,
              totalHtCentimes: b(t.totalHtCentimes),
              totalTvaCentimes: b(t.totalTvaCentimes),
              totalTtcCentimes: b(t.totalTtcCentimes),
              cumpCentimes: l.article.cumpCentimes,
              margeCentimes: b(marge.margeCentimes),
            };
          }),
        },
      },
      include: { lignes: true, client: true },
    });

    return document;
  }

  /**
   * Validation : le document recoit son numero definitif, ses mentions
   * sont figees, et ses effets s'appliquent — sortie de stock, dette du
   * client ou encaissement.
   */
  async valider(params: {
    documentId: string;
    modePaiement?: ModePaiement;
    compteId?: string;
    utilisateurId: string;
  }) {
    const document = await this.prisma.documentVente.findUnique({
      where: { id: params.documentId },
      include: { lignes: true, client: true, magasin: { include: { societe: true } } },
    });
    if (!document) throw new NotFoundException('Document introuvable');
    if (!document.brouillon) throw new ConflictException('Document deja valide');

    const mode = params.modePaiement ?? ModePaiement.CREDIT;
    if (mode !== ModePaiement.CREDIT && !params.compteId) {
      throw new BadRequestException(
        'Un reglement comptant exige le compte de tresorerie credite',
      );
    }
    if (mode === ModePaiement.CREDIT && !document.clientId) {
      throw new BadRequestException('Une vente a credit exige un client identifie');
    }

    const totalTtc = c(document.totalTtcCentimes);

    // Une proforma n'engage rien : ni stock, ni comptabilite. Elle se
    // contente d'un numero, pour pouvoir etre citee.
    const estProforma = document.type === TypeDocumentVente.PROFORMA;

    if (!estProforma && mode === ModePaiement.CREDIT && document.clientId) {
      const decision = await this.tiers.evaluerCredit(document.clientId, totalTtc);
      if (!decision.autorise) {
        throw new ForbiddenException(decision.message ?? 'Vente a credit refusee');
      }
    }

    const emplacement = await this.prisma.emplacement.findFirst({
      where: { magasinId: document.magasinId, parDefautVente: true },
      select: { id: true },
    });
    if (!estProforma && LIVRENT.concat(REPRENNENT).includes(document.type) && !emplacement) {
      throw new BadRequestException(
        'Aucun emplacement de vente par defaut defini pour ce magasin',
      );
    }

    const mentions = this.composerMentions(document);

    const valide = await this.prisma.$transaction(
      async (tx) => {
        const numero = await this.numerotation.suivant(PREFIXES[document.type], { tx });

        if (!estProforma) {
          // Les sorties de stock sont triees par article : deux documents
          // concurrents portant les memes articles ne peuvent pas
          // s'interbloquer sur les memes lignes de stock.
          const sens = REPRENNENT.includes(document.type) ? 1 : -1;
          const sorties = document.lignes
            .map((l) => ({ articleId: l.articleId, quantiteMilli: sens * l.quantiteMilli }))
            .sort((a, x) => (a.articleId < x.articleId ? -1 : a.articleId > x.articleId ? 1 : 0));

          if (LIVRENT.concat(REPRENNENT).includes(document.type)) {
            for (const sortie of sorties) {
              await this.stocks.appliquer(
                {
                  type: REPRENNENT.includes(document.type)
                    ? TypeMouvement.RETOUR_CLIENT
                    : TypeMouvement.VENTE,
                  articleId: sortie.articleId,
                  emplacementId: emplacement!.id,
                  quantiteMilli: sortie.quantiteMilli,
                  documentType: document.type,
                  documentId: document.id,
                  documentNumero: numero,
                  utilisateurId: params.utilisateurId,
                },
                tx,
              );
            }
          }

          const signe = REPRENNENT.includes(document.type) ? -1 : 1;

          if (mode === ModePaiement.CREDIT && document.clientId) {
            await this.tiers.enregistrerMouvement(
              {
                tiersId: document.clientId,
                sens: signe > 0 ? SensMouvementTiers.DEBIT : SensMouvementTiers.CREDIT,
                montantCentimes: totalTtc,
                categorie: document.type,
                libelle: `${document.type.replace(/_/g, ' ')} ${numero}`,
                documentType: document.type,
                documentId: document.id,
                documentNumero: numero,
                utilisateurId: params.utilisateurId,
              },
              tx,
            );
            if (document.dateEcheance && signe > 0) {
              await tx.echeance.create({
                data: {
                  tiersId: document.clientId,
                  documentNumero: numero,
                  montantCentimes: document.totalTtcCentimes,
                  dateEcheance: document.dateEcheance,
                },
              });
            }
          } else if (params.compteId) {
            await this.tresorerie.enregistrer(
              {
                compteId: params.compteId,
                sens: signe > 0 ? SensOperation.ENTREE : SensOperation.SORTIE,
                categorie: CategorieOperation.VENTE_COMPTANT,
                montantCentimes: totalTtc,
                libelle: `${document.type.replace(/_/g, ' ')} ${numero}`,
                tiersId: document.clientId,
                documentType: document.type,
                documentNumero: numero,
                utilisateurId: params.utilisateurId,
              },
              tx,
            );
          }

          await tx.reglement.create({
            data: {
              documentId: document.id,
              mode,
              montantCentimes: document.totalTtcCentimes,
              compteId: params.compteId ?? null,
            },
          });
        }

        return tx.documentVente.update({
          where: { id: document.id },
          data: {
            numero,
            brouillon: false,
            valideLe: new Date(),
            mentions: mentions as unknown as Prisma.InputJsonValue,
            margeCentimes: b(
              document.lignes.reduce((t, l) => t + c(l.margeCentimes), 0),
            ),
          },
          include: { lignes: { orderBy: { numeroLigne: 'asc' } }, client: true, reglements: true },
        });
      },
      { timeout: 120000 },
    );

    await this.audit.journaliser({
      utilisateurId: params.utilisateurId,
      action: 'vente.document_valide',
      entite: 'DocumentVente',
      entiteId: document.id,
      magasinId: document.magasinId,
      details: { numero: valide.numero, type: document.type, totalTtcCentimes: totalTtc, mode },
    });

    return valide;
  }

  /** Mentions legales figees a l'emission (section 8). */
  private composerMentions(document: {
    magasin: { nom: string; adresse: string | null; telephone: string | null;
      rc: string | null; nif: string | null; nis: string | null; articleImposition: string | null;
      societe: { raisonSociale: string; adresse: string | null; telephone: string | null;
        rc: string | null; nif: string | null; nis: string | null; articleImposition: string | null } };
    client: { code: string; raisonSociale: string; adresse: string | null; telephone: string | null;
      rc: string | null; nif: string | null; nis: string | null; articleImposition: string | null } | null;
  }): MentionsLegales {
    const societe = document.magasin.societe;
    // Le magasin peut avoir ses propres identifiants ; sinon ceux de la
    // societe s'appliquent.
    const ou = (a: string | null, b: string | null) => a ?? b ?? null;

    return {
      emetteur: {
        raisonSociale: societe.raisonSociale,
        adresse: ou(document.magasin.adresse, societe.adresse),
        telephone: ou(document.magasin.telephone, societe.telephone),
        rc: ou(document.magasin.rc, societe.rc),
        nif: ou(document.magasin.nif, societe.nif),
        nis: ou(document.magasin.nis, societe.nis),
        articleImposition: ou(document.magasin.articleImposition, societe.articleImposition),
      },
      destinataire: document.client
        ? {
            code: document.client.code,
            raisonSociale: document.client.raisonSociale,
            adresse: document.client.adresse,
            telephone: document.client.telephone,
            rc: document.client.rc,
            nif: document.client.nif,
            nis: document.client.nis,
            articleImposition: document.client.articleImposition,
          }
        : null,
      emisLe: new Date().toISOString(),
    };
  }

  /**
   * Transforme un document en un autre : proforma en facture, bon de
   * livraison en facture, facture en avoir. Le nouveau document naît en
   * brouillon, l'original est conserve et reference.
   */
  async transformer(params: {
    documentId: string;
    vers: TypeDocumentVente;
    utilisateurId: string;
  }) {
    const source = await this.prisma.documentVente.findUnique({
      where: { id: params.documentId },
      include: { lignes: { orderBy: { numeroLigne: 'asc' } } },
    });
    if (!source) throw new NotFoundException('Document introuvable');
    if (source.brouillon) {
      throw new BadRequestException('Validez le document avant de le transformer');
    }
    if (source.statut === StatutDocumentVente.ANNULE) {
      throw new BadRequestException('Document annule');
    }

    const autorisees: Record<string, TypeDocumentVente[]> = {
      [TypeDocumentVente.PROFORMA]: [TypeDocumentVente.FACTURE, TypeDocumentVente.BON_LIVRAISON],
      [TypeDocumentVente.BON_LIVRAISON]: [TypeDocumentVente.FACTURE],
      [TypeDocumentVente.FACTURE]: [TypeDocumentVente.AVOIR],
      [TypeDocumentVente.TICKET]: [TypeDocumentVente.AVOIR, TypeDocumentVente.FACTURE],
    };
    if (!(autorisees[source.type] ?? []).includes(params.vers)) {
      throw new BadRequestException(
        `Un document ${source.type.toLowerCase().replace(/_/g, ' ')} ne se transforme pas ` +
          `en ${params.vers.toLowerCase().replace(/_/g, ' ')}`,
      );
    }

    const dejaFait = await this.prisma.documentVente.findFirst({
      where: { documentSourceId: source.id, type: params.vers, statut: StatutDocumentVente.VALIDE },
      select: { numero: true },
    });
    if (dejaFait) {
      throw new ConflictException(
        `Ce document a deja donne lieu au document ${dejaFait.numero}`,
      );
    }

    // Une facture nee d'un bon de livraison ne ressort pas le stock : la
    // marchandise est deja partie avec le bon.
    const type =
      params.vers === TypeDocumentVente.FACTURE &&
      source.type === TypeDocumentVente.BON_LIVRAISON
        ? TypeDocumentVente.FACTURE
        : params.vers;

    const cree = await this.creer({
      type,
      magasinId: source.magasinId,
      clientId: source.clientId,
      lignes: source.lignes.map((l) => ({
        articleId: l.articleId,
        quantiteMilli: l.quantiteMilli,
        prixUnitaireCentimes: c(l.prixUnitaireCentimes),
        remisePourcent: l.remisePourcent,
      })),
      observation: `Etabli d'apres ${source.numero}`,
      documentSourceId: source.id,
      utilisateurId: params.utilisateurId,
    });

    return { document: cree, source: { id: source.id, numero: source.numero } };
  }

  async parNumero(numero: string) {
    return this.prisma.documentVente.findUniqueOrThrow({
      where: { numero },
      include: {
        lignes: { orderBy: { numeroLigne: 'asc' }, include: { article: { select: { reference: true, unite: true } } } },
        reglements: true,
        client: true,
        utilisateur: { select: { code: true, nom: true } },
        magasin: { include: { societe: true } },
        documentSource: { select: { numero: true, type: true } },
      },
    });
  }

  async lister(params: {
    magasinIds: string[];
    type?: TypeDocumentVente;
    clientId?: string;
    brouillon?: boolean;
    depuis?: Date;
    taille?: number;
  }) {
    return this.prisma.documentVente.findMany({
      where: {
        magasinId: { in: params.magasinIds },
        type: params.type ?? {
          in: [
            TypeDocumentVente.FACTURE, TypeDocumentVente.BON_LIVRAISON,
            TypeDocumentVente.PROFORMA, TypeDocumentVente.AVOIR,
          ],
        },
        ...(params.clientId ? { clientId: params.clientId } : {}),
        ...(params.brouillon !== undefined ? { brouillon: params.brouillon } : {}),
        ...(params.depuis ? { dateVente: { gte: params.depuis } } : {}),
      },
      orderBy: { creeLe: 'desc' },
      take: Math.min(params.taille ?? 100, 500),
      include: {
        client: { select: { code: true, raisonSociale: true } },
        utilisateur: { select: { code: true, nom: true } },
        _count: { select: { lignes: true } },
      },
    });
  }

  /** Supprime un brouillon. Un document valide ne se supprime jamais. */
  async supprimerBrouillon(documentId: string, utilisateurId: string) {
    const document = await this.prisma.documentVente.findUnique({
      where: { id: documentId },
      select: { id: true, numero: true, brouillon: true, type: true },
    });
    if (!document) throw new NotFoundException('Document introuvable');
    if (!document.brouillon) {
      throw new ForbiddenException(
        'Un document valide ne se supprime pas : etablissez un avoir',
      );
    }
    await this.prisma.documentVente.delete({ where: { id: documentId } });
    await this.audit.journaliser({
      utilisateurId,
      action: 'vente.brouillon_supprime',
      entite: 'DocumentVente',
      entiteId: documentId,
      details: { type: document.type },
    });
    return { supprime: true };
  }
}
