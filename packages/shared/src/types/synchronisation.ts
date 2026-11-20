import { Centimes } from '../domain/money';
import { MilliUnites, UniteMesure } from '../domain/quantites';
import { ModePaiement } from '../domain/tarification';

/**
 * Protocole de synchronisation caisse <-> serveur (section 4).
 *
 * Deux sens independants :
 *  - DESCENTE : le serveur envoie le catalogue, les prix, les promotions,
 *    les clients et les droits modifies depuis le dernier curseur ;
 *  - REMONTEE : la caisse pousse ses tickets, mouvements et clotures.
 *
 * La remontee est idempotente : le serveur accuse reception par numero de
 * document, et la caisse ne retire de sa file qu'apres cet accuse.
 */

export const VERSION_PROTOCOLE_SYNC = 1;

export type EtatConnexion = 'EN_LIGNE' | 'HORS_LIGNE' | 'CRITIQUE';

/** Voyant de la caisse : vert / orange / rouge (section 4.6). */
export function etatConnexion(params: {
  derniereSyncReussie: Date | null;
  ticketsEnAttente: number;
  maintenant?: Date;
}): { etat: EtatConnexion; couleur: 'vert' | 'orange' | 'rouge'; message: string } {
  const maintenant = params.maintenant ?? new Date();
  const derniere = params.derniereSyncReussie;
  const heures = derniere ? (maintenant.getTime() - derniere.getTime()) / 3600000 : Infinity;

  if (heures > 24) {
    return {
      etat: 'CRITIQUE',
      couleur: 'rouge',
      message: derniere
        ? `Aucune synchronisation depuis plus de 24 h (${params.ticketsEnAttente} ticket(s) en attente)`
        : 'Jamais synchronisee',
    };
  }
  if (params.ticketsEnAttente > 0 || heures > 0.25) {
    return {
      etat: 'HORS_LIGNE',
      couleur: 'orange',
      message: `Hors ligne — ${params.ticketsEnAttente} ticket(s) en attente d'envoi`,
    };
  }
  return { etat: 'EN_LIGNE', couleur: 'vert', message: 'En ligne' };
}

/* ------------------------------------------------------------------ */
/* DESCENTE : serveur -> caisse                                        */
/* ------------------------------------------------------------------ */

export interface DemandeDescente {
  versionProtocole: number;
  codeMagasin: string;
  numeroCaisse: number;
  /** Curseur rendu par la descente precedente (null = premiere synchro). */
  curseur: string | null;
  /** Taille de page demandee. */
  limite?: number;
}

export interface ArticleSync {
  id: string;
  reference: string;
  designation: string;
  designationAr: string | null;
  unite: UniteMesure;
  decimales: number;
  tauxTva: number;
  prixDetailCentimes: Centimes;
  prixGrosCentimes: Centimes | null;
  prixCat3Centimes: Centimes | null;
  prixCat4Centimes: Centimes | null;
  prixCat5Centimes: Centimes | null;
  /** Cout moyen, utilise pour signaler une vente a perte au chef de caisse. */
  cumpCentimes: Centimes;
  codesBarres: string[];
  /** Pack : article de base et nombre d'unites decrementees du stock. */
  packDeId: string | null;
  packNbUnites: number | null;
  estVrac: boolean;
  venteAutorisee: boolean;
  archive: boolean;
  rayonId: string | null;
  familleId: string | null;
  /** Stock de la surface de vente a la derniere descente (indicatif). */
  stockSvMilli: MilliUnites;
}

export interface ClientSync {
  id: string;
  code: string;
  nom: string;
  categoriePrix: string;
  remisePourcent: number;
  plafondCreditCentimes: Centimes;
  soldeCentimes: Centimes;
  bloque: boolean;
  motifBlocage: string | null;
  carteFidelite: string | null;
  pointsFidelite: number;
}

export interface PromotionSync {
  id: string;
  libelle: string;
  type: 'PRIX_BARRE' | 'X_POUR_Y' | 'REMISE_FAMILLE' | 'HAPPY_HOUR';
  debut: string;
  fin: string;
  articleId: string | null;
  familleId: string | null;
  valeurCentimes: Centimes | null;
  remisePourcent: number | null;
  quantiteDeclenchement: number | null;
  quantiteOfferte: number | null;
  heureDebut: string | null;
  heureFin: string | null;
}

export interface UtilisateurSync {
  id: string;
  code: string;
  nom: string;
  role: string;
  /** Empreinte du PIN (argon2) : le PIN en clair ne quitte jamais le serveur. */
  empreintePin: string;
  permissions: string[];
  actif: boolean;
}

export interface ReponseDescente {
  versionProtocole: number;
  curseur: string;
  /** Vrai s'il reste des pages a recuperer. */
  autresPages: boolean;
  horodatageServeur: string;
  articles: ArticleSync[];
  clients: ClientSync[];
  promotions: PromotionSync[];
  utilisateurs: UtilisateurSync[];
  /** Identifiants d'entites supprimees ou devenues invisibles. */
  supprimes: { articles: string[]; clients: string[]; promotions: string[]; utilisateurs: string[] };
  parametres: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* REMONTEE : caisse -> serveur                                        */
/* ------------------------------------------------------------------ */

export interface LigneTicketSync {
  numeroLigne: number;
  articleId: string;
  /** Code reellement scanne, conserve pour l'audit (code poids compris). */
  codeScanne: string | null;
  designation: string;
  quantiteMilli: MilliUnites;
  prixUnitaireCentimes: Centimes;
  remisePourcent: number;
  remiseCentimes: Centimes;
  tauxTva: number;
  totalHtCentimes: Centimes;
  totalTtcCentimes: Centimes;
  /** CUMP au moment de la vente : fige la marge de la ligne. */
  cumpCentimes: Centimes;
  annulee: boolean;
  autoriseeParUtilisateurId: string | null;
  promotionId: string | null;
}

export interface ReglementSync {
  mode: ModePaiement;
  montantCentimes: Centimes;
  reference: string | null;
}

export interface TicketSync {
  /** Numero unique attribue par la caisse : SV-03-000125. */
  numero: string;
  sessionCaisseNumero: string;
  type: 'VENTE' | 'RETOUR' | 'ANNULATION';
  dateVente: string;
  utilisateurId: string;
  clientId: string | null;
  lignes: LigneTicketSync[];
  reglements: ReglementSync[];
  totalHtCentimes: Centimes;
  totalTvaCentimes: Centimes;
  timbreCentimes: Centimes;
  totalTtcCentimes: Centimes;
  remisePiedCentimes: Centimes;
  renduCentimes: Centimes;
  /** Vrai si le ticket a ete etabli pendant une coupure reseau. */
  horsLigne: boolean;
  /** Vrai si le prix applique n'etait plus celui du serveur (section 4.4). */
  prixPerime: boolean;
  ticketOrigineNumero: string | null;
  forcageSuperviseurId: string | null;
}

/**
 * Session de caisse nee hors ligne.
 *
 * Une session peut s'ouvrir, vendre et se cloturer sans jamais voir le
 * serveur (section 4.7). Elle doit donc remonter comme un document a part
 * entiere, AVANT ses tickets, sinon ceux-ci n'auraient aucune session a
 * laquelle se rattacher.
 */
export interface SessionSync {
  numero: string;
  ouverteLe: string;
  fondDeCaisseCentimes: Centimes;
  utilisateurOuvertureId: string;
  horsLigne: boolean;
}

export interface ClotureSync {
  numero: string;
  sessionCaisseNumero: string;
  ouvertureLe: string;
  clotureLe: string;
  utilisateurOuvertureId: string;
  utilisateurClotureId: string;
  fondDeCaisseCentimes: Centimes;
  comptage: Array<{ coupureCentimes: Centimes; nombre: number }>;
  theoriqueEspecesCentimes: Centimes;
  compteEspecesCentimes: Centimes;
  ecartCentimes: Centimes;
  justification: string | null;
  totauxParMode: Array<{ mode: ModePaiement; montantCentimes: Centimes }>;
  nombreTickets: number;
  horsLigne: boolean;
}

export interface MouvementCaisseSync {
  reference: string;
  type: 'ENTREE_TIROIR' | 'SORTIE_TIROIR' | 'PRELEVEMENT_COFFRE';
  montantCentimes: Centimes;
  motif: string;
  date: string;
  utilisateurId: string;
  sessionCaisseNumero: string;
}

export interface DemandeRemontee {
  versionProtocole: number;
  codeMagasin: string;
  numeroCaisse: number;
  /** Traitees en premier : les tickets s'y rattachent. */
  sessions: SessionSync[];
  tickets: TicketSync[];
  clotures: ClotureSync[];
  mouvements: MouvementCaisseSync[];
}

export type StatutAccuse = 'ACCEPTE' | 'DEJA_RECU' | 'REFUSE';

export interface AccuseReception {
  numero: string;
  statut: StatutAccuse;
  /** Renseigne seulement si statut = REFUSE. */
  erreur: string | null;
}

export interface ReponseRemontee {
  versionProtocole: number;
  horodatageServeur: string;
  sessions: AccuseReception[];
  tickets: AccuseReception[];
  clotures: AccuseReception[];
  mouvements: AccuseReception[];
}
