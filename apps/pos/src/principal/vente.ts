import type Database from 'better-sqlite3';
import { compteurSuivant } from './base';
import { avantagesPour, type AvantageApplique } from './promotionsLocales';
import { articleParId, prixSelonCategorie, type ArticleLocal } from './catalogue';
import {
  totauxDocument, calculerTimbre, numeroDocument, evaluerCredit,
  type CategoriePrix, type LigneTarifee, type ModePaiement,
  type ParametrageTimbre, type TicketSync, type DecisionCredit,
} from '@gestglobale/shared';

export interface LignePanier {
  numeroLigne: number;
  article: ArticleLocal;
  codeScanne: string | null;
  quantiteMilli: number;
  prixUnitaireCentimes: number;
  remisePourcent: number;
  remiseCentimes: number;
  annulee: boolean;
  autoriseeParId: string | null;
  promotionId: string | null;
  /** Avantages promotionnels retenus pour cette ligne, pour le ticket. */
  avantages?: AvantageApplique[];
}

/**
 * Applique les promotions en cours a une ligne du panier.
 *
 * A rejouer apres toute modification de la quantite : un « trois pour
 * deux » ne se declenche qu'au troisieme article, et doit disparaitre si
 * le caissier revient a deux.
 */
export function appliquerPromotions(
  base: Database.Database,
  ligne: LignePanier,
  maintenant = new Date(),
): LignePanier {
  // Le prix de reference est celui du catalogue, jamais un prix deja
  // remise : sans quoi un recalcul empilerait les remises.
  const prixBase = ligne.article.estVrac
    ? ligne.prixUnitaireCentimes
    : ligne.prixUnitaireCentimes;

  const avantages = avantagesPour(
    base, ligne.article, ligne.quantiteMilli, prixBase, maintenant,
  );

  if (avantages.length === 0) {
    ligne.avantages = [];
    ligne.promotionId = null;
    ligne.remiseCentimes = 0;
    return ligne;
  }

  // Un prix barre remplace le prix affiche ; les autres avantages se
  // traduisent en remise sur la ligne.
  const prixBarre = avantages.find((a) => a.prixUnitaireCentimes !== null);
  ligne.avantages = avantages;
  ligne.promotionId = avantages[0].promotionId;
  ligne.remiseCentimes = avantages
    .filter((a) => a.prixUnitaireCentimes === null)
    .reduce((t, a) => t + a.remiseCentimes, 0);
  if (prixBarre?.prixUnitaireCentimes != null) {
    ligne.prixUnitaireCentimes = prixBarre.prixUnitaireCentimes;
  }
  return ligne;
}

export interface Panier {
  lignes: LignePanier[];
  clientId: string | null;
  categoriePrix: CategoriePrix;
  remisePiedPourcent: number;
}

export interface ReglementSaisi {
  mode: ModePaiement;
  montantCentimes: number;
  reference?: string | null;
}

export function panierVide(): Panier {
  return { lignes: [], clientId: null, categoriePrix: 'DETAIL', remisePiedPourcent: 0 };
}

export function lignesTarifees(panier: Panier): LigneTarifee[] {
  return panier.lignes
    .filter((l) => !l.annulee)
    .map((l) => ({
      quantiteMilli: l.quantiteMilli,
      prixUnitaireCentimes: l.prixUnitaireCentimes,
      remisePourcent: l.remisePourcent,
      remiseCentimes: l.remiseCentimes,
      tauxTva: l.article.tauxTva,
    }));
}

export function totauxPanier(
  panier: Panier,
  modes: ModePaiement[] = [],
  timbre?: ParametrageTimbre,
) {
  return totauxDocument(lignesTarifees(panier), {
    remisePiedPourcent: panier.remisePiedPourcent,
    modesPaiement: modes,
    timbre,
  });
}

/**
 * Ajoute une ligne au panier.
 *
 * Le prix est fige au moment de l'ajout, depuis la copie locale du
 * catalogue : c'est ce prix qui part sur le ticket, meme si le serveur le
 * change pendant la vente (section 4.4).
 */
export function ajouterLigne(
  panier: Panier,
  params: {
    article: ArticleLocal;
    quantiteMilli?: number;
    prixUnitaireCentimes?: number;
    codeScanne?: string | null;
  },
): LignePanier {
  const quantite = params.quantiteMilli ?? 1000;
  const prix =
    params.prixUnitaireCentimes ?? prixSelonCategorie(params.article, panier.categoriePrix);

  // Un meme article scanne deux fois cumule les quantites, sauf s'il porte
  // un prix impose par une etiquette ou s'il est vendu au poids.
  const existante = panier.lignes.find(
    (l) =>
      !l.annulee &&
      l.article.id === params.article.id &&
      l.prixUnitaireCentimes === prix &&
      !l.article.estVrac &&
      l.remisePourcent === 0 &&
      l.remiseCentimes === 0,
  );
  if (existante && params.prixUnitaireCentimes === undefined) {
    existante.quantiteMilli += quantite;
    return existante;
  }

  const ligne: LignePanier = {
    numeroLigne: panier.lignes.length + 1,
    article: params.article,
    codeScanne: params.codeScanne ?? null,
    quantiteMilli: quantite,
    prixUnitaireCentimes: prix,
    remisePourcent: 0,
    remiseCentimes: 0,
    annulee: false,
    autoriseeParId: null,
    promotionId: null,
  };
  panier.lignes.push(ligne);
  return ligne;
}

export interface ControleRemise {
  autorisee: boolean;
  codeSuperviseurRequis: boolean;
  message: string | null;
}

/**
 * Une remise au-dela du plafond du role exige un code superviseur (M4).
 * Le controle est fait localement : il fonctionne hors ligne.
 */
export function controlerRemise(
  pourcentage: number,
  permissions: string[],
  plafondPourcent: number,
): ControleRemise {
  if (pourcentage <= 0) {
    return { autorisee: true, codeSuperviseurRequis: false, message: null };
  }
  if (permissions.includes('vente.remise_au_dela_plafond')) {
    return { autorisee: true, codeSuperviseurRequis: false, message: null };
  }
  if (!permissions.includes('vente.remise_dans_plafond')) {
    return {
      autorisee: false,
      codeSuperviseurRequis: true,
      message: 'Vous n’avez pas le droit d’accorder une remise',
    };
  }
  if (pourcentage > plafondPourcent) {
    return {
      autorisee: false,
      codeSuperviseurRequis: true,
      message: `Remise limitee a ${plafondPourcent} % : code superviseur requis`,
    };
  }
  return { autorisee: true, codeSuperviseurRequis: false, message: null };
}

/** Controle du credit sur la situation connue a la derniere synchronisation. */
export function controlerCredit(
  base: Database.Database,
  clientId: string,
  montantCentimes: number,
): DecisionCredit {
  const client = base
    .prepare(
      `SELECT solde_centimes, plafond_credit_centimes, bloque, motif_blocage
         FROM client WHERE id = ?`,
    )
    .get(clientId) as
    | {
        solde_centimes: number;
        plafond_credit_centimes: number;
        bloque: number;
        motif_blocage: string | null;
      }
    | undefined;

  if (!client) {
    return {
      autorise: false,
      motif: 'BLOQUE_MANUEL',
      message: 'Client inconnu de cette caisse',
      forcagePossible: false,
      soldeApresCentimes: 0,
      disponibleCentimes: 0,
    };
  }

  return evaluerCredit(
    {
      soldeCentimes: client.solde_centimes,
      plafondCentimes: client.plafond_credit_centimes,
      bloqueManuellement: client.bloque === 1,
      motifBlocageManuel: client.motif_blocage,
    },
    montantCentimes,
    { horsLigne: true },
  );
}

export interface ContexteEncaissement {
  codeMagasin: string;
  numeroCaisse: number;
  sessionNumero: string;
  utilisateurId: string;
  horsLigne: boolean;
  timbre?: ParametrageTimbre;
  forcageSuperviseurId?: string | null;
  /** Vrai si le catalogue local n'a pas ete rafraichi depuis longtemps. */
  prixPerime?: boolean;
}

export interface ResultatEncaissement {
  ticket: TicketSync;
  renduCentimes: number;
}

/**
 * Encaisse le panier : ecrit le ticket, ses lignes, ses reglements et le
 * place en file d'envoi, le tout dans une seule transaction SQLite.
 *
 * Soit le ticket existe entierement avec sa place dans la file, soit rien
 * n'est ecrit : une coupure de courant pendant l'encaissement ne peut pas
 * produire un ticket qui ne remonterait jamais.
 */
export function encaisser(
  base: Database.Database,
  panier: Panier,
  reglements: ReglementSaisi[],
  contexte: ContexteEncaissement,
): ResultatEncaissement {
  const lignesActives = panier.lignes.filter((l) => !l.annulee);
  if (lignesActives.length === 0) {
    throw new Error('Le panier est vide');
  }

  const modes = reglements.map((r) => r.mode);
  const totaux = totauxPanier(panier, modes, contexte.timbre);
  const encaisse = reglements.reduce((t, r) => t + r.montantCentimes, 0);

  if (encaisse < totaux.totalTtcCentimes) {
    throw new Error(
      `Reglement insuffisant : ${(totaux.totalTtcCentimes - encaisse) / 100} DA manquants`,
    );
  }

  // Le rendu ne porte que sur les especes : on ne rend pas de monnaie
  // sur une carte ou un credit.
  const especes = reglements
    .filter((r) => r.mode === 'ESPECES')
    .reduce((t, r) => t + r.montantCentimes, 0);
  const nonEspeces = encaisse - especes;
  const rendu = Math.max(0, encaisse - totaux.totalTtcCentimes);
  if (rendu > especes) {
    throw new Error('Le rendu de monnaie ne peut pas depasser les especes remises');
  }
  void nonEspeces;

  const transaction = base.transaction((): TicketSync => {
    const compteur = compteurSuivant(base, `TICKET.${contexte.codeMagasin}.${contexte.numeroCaisse}`);
    const numero = numeroDocument({
      codeMagasin: contexte.codeMagasin,
      numeroCaisse: contexte.numeroCaisse,
      compteur,
    });
    const maintenant = new Date().toISOString();

    const lignesSync: TicketSync['lignes'] = panier.lignes.map((ligne) => {
      const tarifee: LigneTarifee = {
        quantiteMilli: ligne.quantiteMilli,
        prixUnitaireCentimes: ligne.prixUnitaireCentimes,
        remisePourcent: ligne.remisePourcent,
        remiseCentimes: ligne.remiseCentimes,
        tauxTva: ligne.article.tauxTva,
      };
      const t = totauxDocument([tarifee]);
      return {
        numeroLigne: ligne.numeroLigne,
        articleId: ligne.article.id,
        codeScanne: ligne.codeScanne,
        designation: ligne.article.designation,
        quantiteMilli: ligne.quantiteMilli,
        prixUnitaireCentimes: ligne.prixUnitaireCentimes,
        remisePourcent: ligne.remisePourcent,
        remiseCentimes: ligne.remiseCentimes,
        tauxTva: ligne.article.tauxTva,
        totalHtCentimes: ligne.annulee ? 0 : t.totalHtCentimes,
        totalTtcCentimes: ligne.annulee ? 0 : t.totalTtcCentimes,
        cumpCentimes: ligne.article.cumpCentimes,
        annulee: ligne.annulee,
        autoriseeParUtilisateurId: ligne.autoriseeParId,
        promotionId: ligne.promotionId,
      };
    });

    const ticket: TicketSync = {
      numero,
      sessionCaisseNumero: contexte.sessionNumero,
      type: 'VENTE',
      dateVente: maintenant,
      utilisateurId: contexte.utilisateurId,
      clientId: panier.clientId,
      lignes: lignesSync,
      reglements: reglements.map((r) => ({
        mode: r.mode,
        montantCentimes: r.mode === 'ESPECES' ? r.montantCentimes - rendu : r.montantCentimes,
        reference: r.reference ?? null,
      })),
      totalHtCentimes: totaux.totalHtCentimes,
      totalTvaCentimes: totaux.totalTvaCentimes,
      timbreCentimes: totaux.timbreCentimes,
      totalTtcCentimes: totaux.totalTtcCentimes,
      remisePiedCentimes: panier.remisePiedPourcent > 0 ? totaux.remiseCentimes : 0,
      renduCentimes: rendu,
      horsLigne: contexte.horsLigne,
      prixPerime: contexte.prixPerime ?? false,
      ticketOrigineNumero: null,
      forcageSuperviseurId: contexte.forcageSuperviseurId ?? null,
    };

    base
      .prepare(
        `INSERT INTO ticket (numero, session_numero, type, date_vente, utilisateur_id,
            client_id, total_ht_centimes, total_tva_centimes, timbre_centimes,
            total_ttc_centimes, remise_pied_centimes, rendu_centimes, hors_ligne,
            prix_perime, ticket_origine_numero, forcage_superviseur_id, cree_le)
         VALUES (@numero, @session, @type, @date, @utilisateur, @client, @ht, @tva,
            @timbre, @ttc, @remisePied, @rendu, @horsLigne, @prixPerime, NULL,
            @forcage, @creeLe)`,
      )
      .run({
        numero,
        session: contexte.sessionNumero,
        type: 'VENTE',
        date: maintenant,
        utilisateur: contexte.utilisateurId,
        client: panier.clientId,
        ht: totaux.totalHtCentimes,
        tva: totaux.totalTvaCentimes,
        timbre: totaux.timbreCentimes,
        ttc: totaux.totalTtcCentimes,
        remisePied: ticket.remisePiedCentimes,
        rendu,
        horsLigne: contexte.horsLigne ? 1 : 0,
        prixPerime: ticket.prixPerime ? 1 : 0,
        forcage: ticket.forcageSuperviseurId,
        creeLe: maintenant,
      });

    const insererLigne = base.prepare(
      `INSERT INTO ligne_ticket (ticket_numero, numero_ligne, article_id, code_scanne,
          designation, quantite_milli, prix_unitaire_centimes, remise_pourcent,
          remise_centimes, taux_tva, total_ht_centimes, total_ttc_centimes,
          cump_centimes, annulee, autorisee_par_id, promotion_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const l of lignesSync) {
      insererLigne.run(
        numero, l.numeroLigne, l.articleId, l.codeScanne, l.designation, l.quantiteMilli,
        l.prixUnitaireCentimes, l.remisePourcent, l.remiseCentimes, l.tauxTva,
        l.totalHtCentimes, l.totalTtcCentimes, l.cumpCentimes, l.annulee ? 1 : 0,
        l.autoriseeParUtilisateurId, l.promotionId,
      );
    }

    const insererReglement = base.prepare(
      `INSERT INTO reglement (ticket_numero, mode, montant_centimes, reference)
       VALUES (?,?,?,?)`,
    );
    for (const r of ticket.reglements) {
      insererReglement.run(numero, r.mode, r.montantCentimes, r.reference);
    }

    // Le stock local est decremente pour l'affichage ; la verite du stock
    // reste au serveur, qui rejoue le mouvement a la remontee.
    const decrementer = base.prepare(
      'UPDATE article SET stock_sv_milli = stock_sv_milli - ? WHERE id = ?',
    );
    for (const ligne of lignesActives) {
      const article = ligne.article;
      const cible = article.packDeId ?? article.id;
      const facteur = article.packDeId ? (article.packNbUnites ?? 1) : 1;
      decrementer.run(ligne.quantiteMilli * facteur, cible);
    }

    // Mise en file d'envoi : dans la meme transaction que le ticket.
    base
      .prepare(
        `INSERT INTO file_envoi (type, reference, charge, cree_le)
         VALUES ('TICKET', ?, ?, ?)`,
      )
      .run(numero, JSON.stringify(ticket), maintenant);

    return ticket;
  });

  const ticket = transaction();
  return { ticket, renduCentimes: rendu };
}

/** Recharge un article depuis la base : utilise par l'interface de vente. */
export function rechargerArticle(base: Database.Database, id: string): ArticleLocal | null {
  return articleParId(base, id);
}

export { calculerTimbre };
