import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { StatutDocumentVente, TypeMouvementCaisse } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { VentesService } from '../ventes/ventes.service';
import { CaisseService } from '../caisse/caisse.service';
import { c } from '../commun/bigint';
import {
  VERSION_PROTOCOLE_SYNC,
  type DemandeDescente, type ReponseDescente, type DemandeRemontee,
  type ReponseRemontee, type AccuseReception, type ArticleSync, type ClientSync,
  type SessionSync,
  type PromotionSync, type UtilisateurSync,
} from '@gestglobale/shared';
import { permissionsEffectives } from '../auth/permissions.util';

/**
 * Curseur de descente.
 *
 * Il porte une position PAR ENTITE, et non une position unique partagee.
 *
 * Un curseur unique etait faux : la position retenue etait la date la plus
 * recente vue toutes entites confondues. Comme les clients sont modifies
 * apres les articles lors d'un import, le curseur sautait au-dela des
 * articles restants, qui n'atteignaient jamais les caisses. Le defaut
 * etait invisible tant que tout tenait dans une page ; sur 30 000
 * articles, 500 seulement descendaient.
 *
 * Chaque position est le couple (date de modification, identifiant), qui
 * est strictement croissant pour l'ordre de tri employe : aucune ligne ne
 * peut etre sautee ni servie deux fois, meme quand des milliers d'entites
 * partagent la meme milliseconde.
 */
interface Position {
  date: number;
  id: string;
}

interface Curseur {
  v: 2;
  articles: Position;
  clients: Position;
  promotions: Position;
  utilisateurs: Position;
  tombstones: number;
}

const POSITION_INITIALE: Position = { date: 0, id: '' };

function curseurVide(): Curseur {
  return {
    v: 2,
    articles: { ...POSITION_INITIALE },
    clients: { ...POSITION_INITIALE },
    promotions: { ...POSITION_INITIALE },
    utilisateurs: { ...POSITION_INITIALE },
    tombstones: 0,
  };
}

function lirePosition(valeur: unknown): Position {
  if (typeof valeur !== 'object' || valeur === null) return { ...POSITION_INITIALE };
  const p = valeur as { date?: unknown; id?: unknown };
  return { date: Number(p.date) || 0, id: typeof p.id === 'string' ? p.id : '' };
}

function lireCurseur(valeur: string | null | undefined): Curseur {
  if (!valeur) return curseurVide();
  try {
    const decode = JSON.parse(Buffer.from(valeur, 'base64url').toString('utf8'));
    // Un curseur de l'ancien format est ignore : la caisse refait une
    // descente complete, ce qui est sans danger (tout est idempotent).
    if (decode?.v !== 2) return curseurVide();
    return {
      v: 2,
      articles: lirePosition(decode.articles),
      clients: lirePosition(decode.clients),
      promotions: lirePosition(decode.promotions),
      utilisateurs: lirePosition(decode.utilisateurs),
      tombstones: Number(decode.tombstones) || 0,
    };
  } catch {
    return curseurVide();
  }
}

function ecrireCurseur(curseur: Curseur): string {
  return Buffer.from(JSON.stringify(curseur), 'utf8').toString('base64url');
}

/** Filtre « strictement apres cette position », pour l'ordre (modifieLe, id). */
function apres(position: Position): {
  OR: Array<{ modifieLe: { gt: Date } } | { modifieLe: Date; id: { gt: string } }>;
} {
  const date = new Date(position.date);
  return {
    OR: [
      { modifieLe: { gt: date } },
      { modifieLe: date, id: { gt: position.id } },
    ],
  };
}

/** Position de la derniere ligne servie, ou la position precedente. */
function positionApres<T extends { id: string; modifieLe: Date }>(
  lignes: T[],
  precedente: Position,
): Position {
  if (lignes.length === 0) return precedente;
  const derniere = lignes[lignes.length - 1];
  return { date: derniere.modifieLe.getTime(), id: derniere.id };
}

const TAILLE_PAGE_DEFAUT = 500;
const TAILLE_PAGE_MAX = 2000;

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ventes: VentesService,
    private readonly caisse: CaisseService,
  ) {}

  private async caisseDepuis(codeMagasin: string, numeroCaisse: number) {
    const caisse = await this.prisma.caisse.findFirst({
      where: { numero: numeroCaisse, magasin: { code: codeMagasin } },
      include: { magasin: { select: { id: true, code: true } } },
    });
    if (!caisse) {
      throw new NotFoundException(`Caisse ${numeroCaisse} inconnue pour le magasin ${codeMagasin}`);
    }
    return caisse;
  }

  /**
   * DESCENTE : le serveur envoie ce qui a change depuis le curseur.
   *
   * Toutes les entites changees sont servies, pas seulement les articles :
   * un prix, un client, une promotion ou un droit modifie doit atteindre la
   * caisse dans les 1 a 5 minutes exigees par la section 4.1.
   */
  async descente(demande: DemandeDescente): Promise<ReponseDescente> {
    if (demande.versionProtocole !== VERSION_PROTOCOLE_SYNC) {
      throw new BadRequestException(
        `Version de protocole non geree : ${demande.versionProtocole} (serveur : ${VERSION_PROTOCOLE_SYNC})`,
      );
    }
    const caisse = await this.caisseDepuis(demande.codeMagasin, demande.numeroCaisse);
    const curseur = lireCurseur(demande.curseur);
    const limite = Math.min(demande.limite ?? TAILLE_PAGE_DEFAUT, TAILLE_PAGE_MAX);

    const [articles, clients, promotions, utilisateurs, tombstones] = await Promise.all([
      this.articlesModifies(curseur.articles, limite, caisse.magasinId),
      this.prisma.tiers.findMany({
        where: { ...apres(curseur.clients), actif: true },
        orderBy: [{ modifieLe: 'asc' }, { id: 'asc' }],
        take: limite,
      }),
      this.prisma.promotion.findMany({
        where: { ...apres(curseur.promotions), actif: true, fin: { gte: new Date() } },
        orderBy: [{ modifieLe: 'asc' }, { id: 'asc' }],
        take: limite,
      }),
      this.prisma.utilisateur.findMany({
        where: {
          ...apres(curseur.utilisateurs),
          magasins: { some: { magasinId: caisse.magasinId } },
        },
        orderBy: [{ modifieLe: 'asc' }, { id: 'asc' }],
        take: limite,
      }),
      this.prisma.tombstone.findMany({
        where: { date: { gt: new Date(curseur.tombstones) } },
        orderBy: { date: 'asc' },
        take: limite,
      }),
    ]);

    const suivant: Curseur = {
      v: 2,
      articles: positionApres(articles, curseur.articles),
      clients: positionApres(clients, curseur.clients),
      promotions: positionApres(promotions, curseur.promotions),
      utilisateurs: positionApres(utilisateurs, curseur.utilisateurs),
      tombstones:
        tombstones.length > 0
          ? tombstones[tombstones.length - 1].date.getTime()
          : curseur.tombstones,
    };

    // Une page pleine signale qu'il en reste, pour chaque entite
    // independamment : la caisse rappelle tant que c'est vrai.
    const autresPages =
      articles.length === limite ||
      clients.length === limite ||
      promotions.length === limite ||
      utilisateurs.length === limite ||
      tombstones.length === limite;

    const parEntite = (entite: string) =>
      tombstones.filter((t) => t.entite === entite).map((t) => t.entiteId);

    const reponse: ReponseDescente = {
      versionProtocole: VERSION_PROTOCOLE_SYNC,
      curseur: ecrireCurseur(suivant),
      autresPages,
      horodatageServeur: new Date().toISOString(),
      articles: articles.map((a) => this.versArticleSync(a, caisse.magasinId)),
      clients: clients.map((t): ClientSync => ({
        id: t.id,
        code: t.code,
        nom: t.raisonSociale,
        categoriePrix: t.categoriePrix,
        remisePourcent: t.remisePourcent,
        plafondCreditCentimes: c(t.plafondCreditCentimes),
        soldeCentimes: c(t.soldeCentimes),
        bloque: t.bloque,
        motifBlocage: t.motifBlocage,
        carteFidelite: t.carteFidelite,
        pointsFidelite: t.pointsFidelite,
      })),
      promotions: promotions.map((p): PromotionSync => ({
        id: p.id,
        libelle: p.libelle,
        type: p.type,
        debut: p.debut.toISOString(),
        fin: p.fin.toISOString(),
        articleId: p.articleId,
        familleId: p.familleId,
        valeurCentimes: p.valeurCentimes === null ? null : c(p.valeurCentimes),
        remisePourcent: p.remisePourcent,
        quantiteDeclenchement: p.quantiteDeclenchement,
        quantiteOfferte: p.quantiteOfferte,
        heureDebut: p.heureDebut,
        heureFin: p.heureFin,
        cumulable: p.cumulable,
      })),
      utilisateurs: utilisateurs.map((u): UtilisateurSync => ({
        id: u.id,
        code: u.code,
        nom: u.nom,
        role: u.role,
        // Seule l'empreinte descend : le PIN en clair ne quitte jamais le
        // serveur, et la caisse peut neanmoins authentifier hors ligne.
        empreintePin: u.pinHash ?? '',
        permissions: permissionsEffectives(u),
        actif: u.actif,
      })),
      supprimes: {
        articles: parEntite('Article'),
        clients: parEntite('Tiers'),
        promotions: parEntite('Promotion'),
        utilisateurs: parEntite('Utilisateur'),
      },
      parametres: await this.parametresCaisse(caisse.magasinId),
    };

    await this.prisma.curseurSync.upsert({
      where: { caisseId: caisse.id },
      create: {
        caisseId: caisse.id,
        curseur: reponse.curseur,
        derniereDescenteLe: new Date(),
      },
      update: { curseur: reponse.curseur, derniereDescenteLe: new Date() },
    });

    return reponse;
  }

  /**
   * Articles modifies depuis la position donnee.
   *
   * Un seul critere suffit : la date de modification de la fiche. Les
   * declencheurs installes sur PrixArticle et CodeBarre la remontent des
   * qu'un prix ou un code bouge, ce qui evite une condition « OR » sur les
   * tables liees — condition qui, elle, ne pouvait pas etre parcourue par
   * curseur et laissait donc passer des changements de prix.
   */
  private async articlesModifies(position: Position, limite: number, magasinId: string) {
    return this.prisma.article.findMany({
      where: apres(position),
      orderBy: [{ modifieLe: 'asc' }, { id: 'asc' }],
      take: limite,
      include: {
        codesBarres: { select: { code: true } },
        prix: { where: { OR: [{ magasinId: null }, { magasinId }] } },
        stocks: {
          where: { emplacement: { magasinId, parDefautVente: true } },
          select: { quantiteMilli: true },
        },
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private versArticleSync(article: any, magasinId: string): ArticleSync {
    // Le prix du magasin prime sur celui du siege (M11).
    const prix = (categorie: string): number | null => {
      const local = article.prix.find(
        (p: { magasinId: string | null; categorie: string }) =>
          p.magasinId === magasinId && p.categorie === categorie,
      );
      const siege = article.prix.find(
        (p: { magasinId: string | null; categorie: string }) =>
          p.magasinId === null && p.categorie === categorie,
      );
      const choisi = local ?? siege;
      return choisi ? c(choisi.prixCentimes) : null;
    };

    // Un pack porte son prix dans la categorie PACK : sans cette reprise,
    // il descendrait a zero et la caisse le vendrait gratuitement.
    const prixVente = article.packDeId
      ? (prix('PACK') ?? prix('DETAIL') ?? 0)
      : (prix('DETAIL') ?? prix('PACK') ?? 0);

    return {
      id: article.id,
      reference: article.reference,
      designation: article.designation,
      designationAr: article.designationAr,
      unite: article.unite,
      decimales: article.decimales,
      tauxTva: article.tauxTva,
      prixDetailCentimes: prixVente,
      prixGrosCentimes: prix('GROS'),
      prixCat3Centimes: prix('CAT3'),
      prixCat4Centimes: prix('CAT4'),
      prixCat5Centimes: prix('CAT5'),
      cumpCentimes: c(article.cumpCentimes),
      codesBarres: article.codesBarres.map((cb: { code: string }) => cb.code),
      packDeId: article.packDeId,
      packNbUnites: article.packNbUnites,
      estVrac: article.estVrac,
      venteAutorisee: article.venteAutorisee && !article.archive,
      archive: article.archive,
      rayonId: article.rayonId,
      familleId: article.familleId,
      stockSvMilli: article.stocks?.[0]?.quantiteMilli ?? 0,
    };
  }

  private async parametresCaisse(magasinId: string): Promise<Record<string, unknown>> {
    const parametres = await this.prisma.parametre.findMany({
      where: { OR: [{ magasinId }, { magasinId: null }], cle: { startsWith: 'caisse.' } },
    });
    const resultat: Record<string, unknown> = {};
    // Le parametre du magasin ecrase celui du siege.
    for (const p of parametres.filter((p) => p.magasinId === null)) resultat[p.cle] = p.valeur;
    for (const p of parametres.filter((p) => p.magasinId !== null)) resultat[p.cle] = p.valeur;
    return resultat;
  }

  /**
   * REMONTEE : la caisse pousse tickets, clotures et mouvements.
   *
   * Chaque element recoit un accuse individuel. La caisse ne retire de sa
   * file que ce qui est ACCEPTE ou DEJA_RECU ; un REFUSE reste en file et
   * remonte dans le rapport des anomalies, sans bloquer les autres.
   */
  async remontee(demande: DemandeRemontee): Promise<ReponseRemontee> {
    if (demande.versionProtocole !== VERSION_PROTOCOLE_SYNC) {
      throw new BadRequestException(
        `Version de protocole non geree : ${demande.versionProtocole}`,
      );
    }
    const caisse = await this.caisseDepuis(demande.codeMagasin, demande.numeroCaisse);
    const contexte = { magasinId: caisse.magasinId, caisseId: caisse.id };

    // Les sessions passent en premier : un ticket ne peut se rattacher qu'a
    // une session deja connue du serveur.
    const sessions: AccuseReception[] = [];
    for (const session of demande.sessions ?? []) {
      sessions.push(await this.enregistrerSession(session, caisse.id));
    }

    const tickets: AccuseReception[] = [];
    for (const ticket of demande.tickets) {
      const resultat = await this.ventes.enregistrerTicket(ticket, contexte);
      tickets.push({
        numero: resultat.numero,
        statut: resultat.statut,
        erreur: resultat.erreur ?? null,
      });
      if (resultat.statut === 'REFUSE') {
        this.logger.warn(`Ticket refuse ${ticket.numero} : ${resultat.erreur}`);
      }
    }

    // Les mouvements de tiroir passent AVANT les clotures : ils ont eu lieu
    // pendant la session, donc avant sa fermeture. Les traiter apres
    // reviendrait a les presenter sur une session deja cloturee.
    const mouvements: AccuseReception[] = [];
    for (const mouvement of demande.mouvements) {
      try {
        const existant = await this.prisma.mouvementCaisse.findUnique({
          where: { reference: mouvement.reference },
          select: { id: true },
        });
        if (existant) {
          mouvements.push({ numero: mouvement.reference, statut: 'DEJA_RECU', erreur: null });
          continue;
        }
        const session = await this.prisma.sessionCaisse.findUnique({
          where: { numero: mouvement.sessionCaisseNumero },
          select: { id: true },
        });
        if (!session) {
          mouvements.push({
            numero: mouvement.reference,
            statut: 'REFUSE',
            erreur: `Session inconnue : ${mouvement.sessionCaisseNumero}`,
          });
          continue;
        }
        await this.caisse.mouvementCaisse({
          sessionId: session.id,
          // Rejeu d'un fait passe : la session a pu etre cloturee entre
          // temps, notamment si la cloture est remontee dans un lot
          // anterieur. Le mouvement doit tout de meme etre conserve.
          rejeu: true,
          type: mouvement.type as TypeMouvementCaisse,
          montantCentimes: mouvement.montantCentimes,
          motif: mouvement.motif,
          utilisateurId: mouvement.utilisateurId,
          reference: mouvement.reference,
        });
        mouvements.push({ numero: mouvement.reference, statut: 'ACCEPTE', erreur: null });
      } catch (erreur) {
        mouvements.push({
          numero: mouvement.reference,
          statut: 'REFUSE',
          erreur: erreur instanceof Error ? erreur.message : String(erreur),
        });
      }
    }

    const clotures: AccuseReception[] = [];
    for (const cloture of demande.clotures) {
      const resultat = await this.caisse.enregistrerClotureRemontee(cloture);
      clotures.push({
        numero: resultat.numero,
        statut: resultat.statut,
        erreur: resultat.erreur ?? null,
      });
    }

    await this.prisma.curseurSync.upsert({
      where: { caisseId: caisse.id },
      create: { caisseId: caisse.id, derniereRemonteeLe: new Date() },
      update: { derniereRemonteeLe: new Date() },
    });

    const refuses = [...sessions, ...tickets, ...clotures, ...mouvements].filter(
      (a) => a.statut === 'REFUSE',
    );
    if (refuses.length > 0) {
      await this.audit.journaliser({
        action: 'sync.elements_refuses',
        caisseId: caisse.id,
        magasinId: caisse.magasinId,
        details: { refuses: refuses.map((r) => ({ numero: r.numero, erreur: r.erreur })) },
      });
    }

    return {
      versionProtocole: VERSION_PROTOCOLE_SYNC,
      horodatageServeur: new Date().toISOString(),
      sessions,
      tickets,
      clotures,
      mouvements,
    };
  }

  /**
   * Enregistre une session ouverte hors ligne.
   *
   * Idempotente sur le numero, lui aussi attribue par la caisse : une
   * session deja connue est simplement acquittee.
   */
  private async enregistrerSession(
    session: SessionSync,
    caisseId: string,
  ): Promise<AccuseReception> {
    try {
      const existante = await this.prisma.sessionCaisse.findUnique({
        where: { numero: session.numero },
        select: { id: true },
      });
      if (existante) {
        return { numero: session.numero, statut: 'DEJA_RECU', erreur: null };
      }
      await this.prisma.sessionCaisse.create({
        data: {
          numero: session.numero,
          caisseId,
          ouverteLe: new Date(session.ouverteLe),
          fondDeCaisseCentimes: BigInt(Math.round(session.fondDeCaisseCentimes)),
          utilisateurOuvertureId: session.utilisateurOuvertureId,
          horsLigne: session.horsLigne,
        },
      });
      return { numero: session.numero, statut: 'ACCEPTE', erreur: null };
    } catch (erreur) {
      if (
        erreur instanceof Error &&
        'code' in erreur &&
        (erreur as { code?: string }).code === 'P2002'
      ) {
        return { numero: session.numero, statut: 'DEJA_RECU', erreur: null };
      }
      return {
        numero: session.numero,
        statut: 'REFUSE',
        erreur: erreur instanceof Error ? erreur.message : String(erreur),
      };
    }
  }

  /** Etat de synchronisation de toutes les caisses, pour le gerant. */
  async etatCaisses(magasinIds: string[]) {
    const caisses = await this.prisma.caisse.findMany({
      where: { magasinId: { in: magasinIds }, actif: true },
      include: {
        curseurSync: true,
        magasin: { select: { code: true, nom: true } },
        sessions: {
          where: { statut: 'OUVERTE' },
          select: { numero: true, ouverteLe: true },
        },
      },
    });

    const maintenant = Date.now();
    return caisses.map((caisse) => {
      const derniere = caisse.curseurSync?.derniereRemonteeLe ?? null;
      const heures = derniere ? (maintenant - derniere.getTime()) / 3600000 : Infinity;
      return {
        caisseId: caisse.id,
        numero: caisse.numero,
        libelle: caisse.libelle,
        magasin: caisse.magasin,
        sessionOuverte: caisse.sessions[0] ?? null,
        derniereDescenteLe: caisse.curseurSync?.derniereDescenteLe ?? null,
        derniereRemonteeLe: derniere,
        // Une caisse installee mais jamais synchronisee n'est pas « en
        // retard de 24 h » : elle n'a simplement jamais parle au serveur.
        jamaisSynchronisee: derniere === null,
        couleur: heures > 24 ? 'rouge' : heures > 0.25 ? 'orange' : 'vert',
      };
    });
  }

  /**
   * Tickets vendus a un prix perime (section 4.4) : le serveur fait foi
   * pour les prix, la caisse fait foi pour les ventes realisees, donc le
   * ticket est conserve tel quel mais signale.
   */
  ticketsPrixPerime(magasinIds: string[], jours = 7) {
    const depuis = new Date();
    depuis.setDate(depuis.getDate() - jours);
    return this.prisma.documentVente.findMany({
      where: {
        magasinId: { in: magasinIds },
        prixPerime: true,
        dateVente: { gte: depuis },
        statut: StatutDocumentVente.VALIDE,
      },
      orderBy: { dateVente: 'desc' },
      take: 500,
      include: {
        lignes: { select: { designation: true, prixUnitaireCentimes: true, quantiteMilli: true } },
        caisse: { select: { numero: true } },
        utilisateur: { select: { code: true, nom: true } },
      },
    });
  }
}
