import type Database from 'better-sqlite3';
import { compteurSuivant } from './base';
import {
  calculerCloture, numeroDocument,
  type ClotureSync, type LigneComptage, type ModePaiement, type ReglementTheorique,
  type SessionSync,
} from '@gestglobale/shared';

/**
 * Sessions de caisse et cloture Z, cote caisse.
 *
 * Tout fonctionne hors ligne : l'ouverture, les mouvements de tiroir et la
 * cloture Z sont calcules sur la base locale, puis remontes avec les
 * tickets (section 4.7).
 */

export interface SessionLocale {
  numero: string;
  statut: 'OUVERTE' | 'CLOTUREE';
  ouverteLe: string;
  fondDeCaisseCentimes: number;
  utilisateurOuvertureId: string;
}

export function sessionOuverte(base: Database.Database): SessionLocale | null {
  const ligne = base
    .prepare(`SELECT * FROM session_caisse WHERE statut = 'OUVERTE' ORDER BY ouverte_le DESC LIMIT 1`)
    .get() as
    | {
        numero: string;
        statut: string;
        ouverte_le: string;
        fond_de_caisse_centimes: number;
        utilisateur_ouverture_id: string;
      }
    | undefined;
  if (!ligne) return null;
  return {
    numero: ligne.numero,
    statut: ligne.statut as 'OUVERTE',
    ouverteLe: ligne.ouverte_le,
    fondDeCaisseCentimes: ligne.fond_de_caisse_centimes,
    utilisateurOuvertureId: ligne.utilisateur_ouverture_id,
  };
}

/**
 * Ouverture avec fond de caisse.
 *
 * La cloture precedente est bloquante : tant qu'une session est ouverte,
 * aucune autre ne peut demarrer (M4). Ce controle existe aussi au serveur,
 * mais il doit tenir hors ligne, donc il est rejoue ici.
 */
export function ouvrirSession(
  base: Database.Database,
  params: {
    codeMagasin: string;
    numeroCaisse: number;
    fondDeCaisseCentimes: number;
    utilisateurId: string;
    horsLigne?: boolean;
  },
): SessionLocale {
  const existante = sessionOuverte(base);
  if (existante) {
    throw new Error(
      `La session ${existante.numero} est encore ouverte : cloturez-la avant d'en ouvrir une autre`,
    );
  }

  const compteur = compteurSuivant(base, `SESSION.${params.codeMagasin}.${params.numeroCaisse}`);
  const numero = `Z-${numeroDocument({
    codeMagasin: params.codeMagasin,
    numeroCaisse: params.numeroCaisse,
    compteur,
    longueurCompteur: 5,
  })}`;
  const maintenant = new Date().toISOString();

  const charge: SessionSync = {
    numero,
    ouverteLe: maintenant,
    fondDeCaisseCentimes: params.fondDeCaisseCentimes,
    utilisateurOuvertureId: params.utilisateurId,
    horsLigne: params.horsLigne ?? false,
  };

  // La session part en file d'envoi des son ouverture : le serveur doit la
  // connaitre avant les tickets qui s'y rattachent.
  base.transaction(() => {
    base
      .prepare(
        `INSERT INTO session_caisse (numero, statut, ouverte_le, fond_de_caisse_centimes,
            utilisateur_ouverture_id, hors_ligne)
         VALUES (?, 'OUVERTE', ?, ?, ?, ?)`,
      )
      .run(numero, maintenant, params.fondDeCaisseCentimes, params.utilisateurId,
        params.horsLigne ? 1 : 0);
    base
      .prepare(
        `INSERT INTO file_envoi (type, reference, charge, cree_le)
         VALUES ('SESSION', ?, ?, ?)`,
      )
      .run(numero, JSON.stringify(charge), maintenant);
  })();

  return {
    numero,
    statut: 'OUVERTE',
    ouverteLe: maintenant,
    fondDeCaisseCentimes: params.fondDeCaisseCentimes,
    utilisateurOuvertureId: params.utilisateurId,
  };
}

/** Totaux theoriques de la session, calcules depuis les tickets locaux. */
export function totauxSession(base: Database.Database, sessionNumero: string) {
  const parMode = base
    .prepare(
      `SELECT r.mode AS mode, SUM(r.montant_centimes) AS total
         FROM reglement r
         JOIN ticket t ON t.numero = r.ticket_numero
        WHERE t.session_numero = ?
        GROUP BY r.mode`,
    )
    .all(sessionNumero) as Array<{ mode: string; total: number }>;

  const tickets = base
    .prepare('SELECT COUNT(*) AS n FROM ticket WHERE session_numero = ?')
    .get(sessionNumero) as { n: number };

  const mouvements = base
    .prepare(
      `SELECT type, SUM(montant_centimes) AS total
         FROM mouvement_caisse WHERE session_numero = ? GROUP BY type`,
    )
    .all(sessionNumero) as Array<{ type: string; total: number }>;

  const parType = (type: string) => mouvements.find((m) => m.type === type)?.total ?? 0;

  const session = base
    .prepare('SELECT fond_de_caisse_centimes FROM session_caisse WHERE numero = ?')
    .get(sessionNumero) as { fond_de_caisse_centimes: number } | undefined;

  return {
    theoriques: parMode.map(
      (m): ReglementTheorique => ({ mode: m.mode as ModePaiement, montantCentimes: m.total }),
    ),
    nombreTickets: tickets.n,
    fondDeCaisseCentimes: session?.fond_de_caisse_centimes ?? 0,
    entreesEspecesCentimes: parType('ENTREE_TIROIR'),
    sortiesEspecesCentimes: parType('SORTIE_TIROIR'),
    preleveeVersCoffreCentimes: parType('PRELEVEMENT_COFFRE'),
  };
}

/** Previsualisation : le caissier voit l'ecart avant de valider. */
export function previsualiserCloture(
  base: Database.Database,
  sessionNumero: string,
  comptage: LigneComptage[],
) {
  const totaux = totauxSession(base, sessionNumero);
  return {
    ...calculerCloture({
      fondDeCaisseCentimes: totaux.fondDeCaisseCentimes,
      theoriques: totaux.theoriques,
      comptageEspeces: comptage,
      entreesEspecesCentimes: totaux.entreesEspecesCentimes,
      sortiesEspecesCentimes: totaux.sortiesEspecesCentimes,
      preleveeVersCoffreCentimes: totaux.preleveeVersCoffreCentimes,
    }),
    nombreTickets: totaux.nombreTickets,
  };
}

/**
 * Cloture Z locale.
 *
 * Le comptage par coupure est obligatoire, l'ecart est toujours calcule, et
 * une justification est exigee des qu'il n'est pas nul. La cloture part
 * ensuite en file d'envoi comme un ticket.
 */
export function cloturerSession(
  base: Database.Database,
  params: {
    sessionNumero: string;
    comptage: LigneComptage[];
    justification?: string;
    utilisateurId: string;
    horsLigne: boolean;
  },
): { cloture: ClotureSync; ecartCentimes: number } {
  const session = base
    .prepare('SELECT * FROM session_caisse WHERE numero = ?')
    .get(params.sessionNumero) as
    | {
        numero: string;
        statut: string;
        ouverte_le: string;
        fond_de_caisse_centimes: number;
        utilisateur_ouverture_id: string;
      }
    | undefined;

  if (!session) throw new Error('Session introuvable');
  if (session.statut === 'CLOTUREE') throw new Error('Session deja cloturee');
  if (params.comptage.length === 0) {
    throw new Error('Le comptage des especes par coupure est obligatoire pour cloturer');
  }

  const resultat = previsualiserCloture(base, params.sessionNumero, params.comptage);
  if (resultat.justificationRequise && !params.justification?.trim()) {
    throw new Error(
      `Ecart de ${resultat.ecartEspecesCentimes / 100} DA : une justification est obligatoire`,
    );
  }

  const maintenant = new Date().toISOString();
  const numero = `${params.sessionNumero}-Z`;

  const cloture: ClotureSync = {
    numero,
    sessionCaisseNumero: params.sessionNumero,
    ouvertureLe: session.ouverte_le,
    clotureLe: maintenant,
    utilisateurOuvertureId: session.utilisateur_ouverture_id,
    utilisateurClotureId: params.utilisateurId,
    fondDeCaisseCentimes: session.fond_de_caisse_centimes,
    comptage: params.comptage,
    theoriqueEspecesCentimes: resultat.theoriqueEspecesCentimes,
    compteEspecesCentimes: resultat.compteEspecesCentimes,
    ecartCentimes: resultat.ecartEspecesCentimes,
    justification: params.justification ?? null,
    totauxParMode: resultat.totauxParMode,
    nombreTickets: resultat.nombreTickets,
    horsLigne: params.horsLigne,
  };

  base.transaction(() => {
    base
      .prepare(
        `INSERT INTO cloture (numero, session_numero, ouverture_le, cloture_le,
            utilisateur_ouverture_id, utilisateur_cloture_id, fond_de_caisse_centimes,
            comptage, theorique_especes_centimes, compte_especes_centimes,
            ecart_centimes, justification, totaux_par_mode, nombre_tickets, hors_ligne)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        numero, params.sessionNumero, session.ouverte_le, maintenant,
        session.utilisateur_ouverture_id, params.utilisateurId,
        session.fond_de_caisse_centimes, JSON.stringify(params.comptage),
        resultat.theoriqueEspecesCentimes, resultat.compteEspecesCentimes,
        resultat.ecartEspecesCentimes, params.justification ?? null,
        JSON.stringify(resultat.totauxParMode), resultat.nombreTickets,
        params.horsLigne ? 1 : 0,
      );

    base
      .prepare(
        `UPDATE session_caisse
            SET statut = 'CLOTUREE', cloturee_le = ?, utilisateur_cloture_id = ?
          WHERE numero = ?`,
      )
      .run(maintenant, params.utilisateurId, params.sessionNumero);

    base
      .prepare(
        `INSERT INTO file_envoi (type, reference, charge, cree_le)
         VALUES ('CLOTURE', ?, ?, ?)`,
      )
      .run(numero, JSON.stringify(cloture), maintenant);
  })();

  return { cloture, ecartCentimes: resultat.ecartEspecesCentimes };
}

/** Mouvement d'especes du tiroir hors vente, mis en file comme le reste. */
export function mouvementCaisse(
  base: Database.Database,
  params: {
    reference: string;
    sessionNumero: string;
    type: 'ENTREE_TIROIR' | 'SORTIE_TIROIR' | 'PRELEVEMENT_COFFRE';
    montantCentimes: number;
    motif: string;
    utilisateurId: string;
  },
): void {
  const maintenant = new Date().toISOString();
  const charge = {
    reference: params.reference,
    type: params.type,
    montantCentimes: params.montantCentimes,
    motif: params.motif,
    date: maintenant,
    utilisateurId: params.utilisateurId,
    sessionCaisseNumero: params.sessionNumero,
  };

  base.transaction(() => {
    base
      .prepare(
        `INSERT INTO mouvement_caisse (reference, session_numero, type, montant_centimes,
            motif, date, utilisateur_id)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(params.reference, params.sessionNumero, params.type, params.montantCentimes,
        params.motif, maintenant, params.utilisateurId);
    base
      .prepare(
        `INSERT INTO file_envoi (type, reference, charge, cree_le)
         VALUES ('MOUVEMENT', ?, ?, ?)`,
      )
      .run(params.reference, JSON.stringify(charge), maintenant);
  })();
}
