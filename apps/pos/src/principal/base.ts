import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Base locale de la caisse (SQLite).
 *
 * La caisse vend TOUJOURS sur cette base : le serveur n'est jamais attendu
 * pour encaisser (section 4). Le catalogue, les prix, les clients et les
 * droits en sont une copie descendue par synchronisation ; les tickets,
 * clotures et mouvements y naissent puis attendent leur accuse de reception
 * dans une file d'envoi.
 *
 * Reglages retenus :
 *  - journal WAL : les lectures du catalogue ne bloquent pas l'ecriture
 *    d'un ticket pendant la vente ;
 *  - synchronous = FULL : une coupure de courant ne doit pas perdre un
 *    ticket deja encaisse, ce qui prime sur la vitesse d'ecriture.
 */
export function ouvrirBase(chemin: string): Database.Database {
  if (chemin !== ':memory:') mkdirSync(dirname(chemin), { recursive: true });

  const base = new Database(chemin);
  base.pragma('journal_mode = WAL');
  base.pragma('synchronous = FULL');
  base.pragma('foreign_keys = ON');
  creerSchema(base);
  return base;
}

export function creerSchema(base: Database.Database): void {
  base.exec(`
    -- ---------------------------------------------------------------
    -- Copie locale du referentiel (descendue du serveur)
    -- ---------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS article (
      id                    TEXT PRIMARY KEY,
      reference             TEXT NOT NULL,
      designation           TEXT NOT NULL,
      designation_ar        TEXT,
      unite                 TEXT NOT NULL DEFAULT 'UN',
      decimales             INTEGER NOT NULL DEFAULT 0,
      taux_tva              INTEGER NOT NULL DEFAULT 0,
      prix_detail_centimes  INTEGER NOT NULL DEFAULT 0,
      prix_gros_centimes    INTEGER,
      prix_cat3_centimes    INTEGER,
      prix_cat4_centimes    INTEGER,
      prix_cat5_centimes    INTEGER,
      cump_centimes         INTEGER NOT NULL DEFAULT 0,
      pack_de_id            TEXT,
      pack_nb_unites        INTEGER,
      est_vrac              INTEGER NOT NULL DEFAULT 0,
      vente_autorisee       INTEGER NOT NULL DEFAULT 1,
      archive               INTEGER NOT NULL DEFAULT 0,
      rayon_id              TEXT,
      famille_id            TEXT,
      stock_sv_milli        INTEGER NOT NULL DEFAULT 0,
      descendu_le           TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_article_designation ON article(designation);
    CREATE INDEX IF NOT EXISTS idx_article_reference   ON article(reference);

    -- Un code-barres n'appartient qu'a un article : c'est la contrainte
    -- d'unicite du catalogue, rejouee localement.
    CREATE TABLE IF NOT EXISTS code_barre (
      code       TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES article(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS client (
      id                      TEXT PRIMARY KEY,
      code                    TEXT NOT NULL,
      nom                     TEXT NOT NULL,
      categorie_prix          TEXT NOT NULL DEFAULT 'DETAIL',
      remise_pourcent         INTEGER NOT NULL DEFAULT 0,
      plafond_credit_centimes INTEGER NOT NULL DEFAULT 0,
      -- Solde connu a la derniere synchronisation : il sert au controle
      -- du plafond hors ligne (section 4.5).
      solde_centimes          INTEGER NOT NULL DEFAULT 0,
      bloque                  INTEGER NOT NULL DEFAULT 0,
      motif_blocage           TEXT,
      carte_fidelite          TEXT,
      points_fidelite         INTEGER NOT NULL DEFAULT 0,
      descendu_le             TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_client_carte ON client(carte_fidelite);
    CREATE INDEX IF NOT EXISTS idx_client_nom   ON client(nom);

    CREATE TABLE IF NOT EXISTS promotion (
      id                     TEXT PRIMARY KEY,
      libelle                TEXT NOT NULL,
      type                   TEXT NOT NULL,
      debut                  TEXT NOT NULL,
      fin                    TEXT NOT NULL,
      article_id             TEXT,
      famille_id             TEXT,
      valeur_centimes        INTEGER,
      remise_pourcent        INTEGER,
      quantite_declenchement INTEGER,
      quantite_offerte       INTEGER,
      heure_debut            TEXT,
      heure_fin              TEXT
    );

    -- Les droits descendent avec les utilisateurs : la caisse authentifie
    -- et autorise seule pendant une coupure.
    CREATE TABLE IF NOT EXISTS utilisateur (
      id             TEXT PRIMARY KEY,
      code           TEXT NOT NULL UNIQUE,
      nom            TEXT NOT NULL,
      role           TEXT NOT NULL,
      empreinte_pin  TEXT NOT NULL,
      permissions    TEXT NOT NULL DEFAULT '[]',
      actif          INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS parametre (
      cle    TEXT PRIMARY KEY,
      valeur TEXT NOT NULL
    );

    -- ---------------------------------------------------------------
    -- Documents nes en caisse
    -- ---------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS session_caisse (
      numero                   TEXT PRIMARY KEY,
      statut                   TEXT NOT NULL DEFAULT 'OUVERTE',
      ouverte_le               TEXT NOT NULL,
      cloturee_le              TEXT,
      fond_de_caisse_centimes  INTEGER NOT NULL DEFAULT 0,
      utilisateur_ouverture_id TEXT NOT NULL,
      utilisateur_cloture_id   TEXT,
      hors_ligne               INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ticket (
      numero                 TEXT PRIMARY KEY,
      session_numero         TEXT NOT NULL REFERENCES session_caisse(numero),
      type                   TEXT NOT NULL DEFAULT 'VENTE',
      date_vente             TEXT NOT NULL,
      utilisateur_id         TEXT NOT NULL,
      client_id              TEXT,
      total_ht_centimes      INTEGER NOT NULL DEFAULT 0,
      total_tva_centimes     INTEGER NOT NULL DEFAULT 0,
      timbre_centimes        INTEGER NOT NULL DEFAULT 0,
      total_ttc_centimes     INTEGER NOT NULL DEFAULT 0,
      remise_pied_centimes   INTEGER NOT NULL DEFAULT 0,
      rendu_centimes         INTEGER NOT NULL DEFAULT 0,
      hors_ligne             INTEGER NOT NULL DEFAULT 0,
      prix_perime            INTEGER NOT NULL DEFAULT 0,
      ticket_origine_numero  TEXT,
      forcage_superviseur_id TEXT,
      cree_le                TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_session ON ticket(session_numero);

    CREATE TABLE IF NOT EXISTS ligne_ticket (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_numero          TEXT NOT NULL REFERENCES ticket(numero) ON DELETE CASCADE,
      numero_ligne           INTEGER NOT NULL,
      article_id             TEXT NOT NULL,
      code_scanne            TEXT,
      designation            TEXT NOT NULL,
      quantite_milli         INTEGER NOT NULL,
      prix_unitaire_centimes INTEGER NOT NULL,
      remise_pourcent        INTEGER NOT NULL DEFAULT 0,
      remise_centimes        INTEGER NOT NULL DEFAULT 0,
      taux_tva               INTEGER NOT NULL DEFAULT 0,
      total_ht_centimes      INTEGER NOT NULL DEFAULT 0,
      total_ttc_centimes     INTEGER NOT NULL DEFAULT 0,
      cump_centimes          INTEGER NOT NULL DEFAULT 0,
      annulee                INTEGER NOT NULL DEFAULT 0,
      autorisee_par_id       TEXT,
      promotion_id           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ligne_ticket ON ligne_ticket(ticket_numero);

    CREATE TABLE IF NOT EXISTS reglement (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_numero   TEXT NOT NULL REFERENCES ticket(numero) ON DELETE CASCADE,
      mode            TEXT NOT NULL,
      montant_centimes INTEGER NOT NULL,
      reference       TEXT
    );

    CREATE TABLE IF NOT EXISTS cloture (
      numero                      TEXT PRIMARY KEY,
      session_numero              TEXT NOT NULL REFERENCES session_caisse(numero),
      ouverture_le                TEXT NOT NULL,
      cloture_le                  TEXT NOT NULL,
      utilisateur_ouverture_id    TEXT NOT NULL,
      utilisateur_cloture_id      TEXT NOT NULL,
      fond_de_caisse_centimes     INTEGER NOT NULL,
      comptage                    TEXT NOT NULL,
      theorique_especes_centimes  INTEGER NOT NULL,
      compte_especes_centimes     INTEGER NOT NULL,
      ecart_centimes              INTEGER NOT NULL,
      justification               TEXT,
      totaux_par_mode             TEXT NOT NULL,
      nombre_tickets              INTEGER NOT NULL DEFAULT 0,
      hors_ligne                  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS mouvement_caisse (
      reference        TEXT PRIMARY KEY,
      session_numero   TEXT NOT NULL REFERENCES session_caisse(numero),
      type             TEXT NOT NULL,
      montant_centimes INTEGER NOT NULL,
      motif            TEXT NOT NULL,
      date             TEXT NOT NULL,
      utilisateur_id   TEXT NOT NULL
    );

    -- ---------------------------------------------------------------
    -- File d'envoi
    -- ---------------------------------------------------------------
    -- Un element n'est retire qu'apres accuse de reception du serveur
    -- (section 4.2). Tant qu'il est la, la caisse le renvoie.
    CREATE TABLE IF NOT EXISTS file_envoi (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      type             TEXT NOT NULL CHECK (type IN ('SESSION','TICKET','CLOTURE','MOUVEMENT')),
      reference        TEXT NOT NULL,
      charge           TEXT NOT NULL,
      cree_le          TEXT NOT NULL,
      tentatives       INTEGER NOT NULL DEFAULT 0,
      derniere_erreur  TEXT,
      derniere_tentative TEXT,
      UNIQUE (type, reference)
    );
    CREATE INDEX IF NOT EXISTS idx_file_ordre ON file_envoi(id);

    -- Compteurs locaux : la caisse numerote seule, donc reste unique
    -- meme coupee du serveur (section 4.3).
    CREATE TABLE IF NOT EXISTS compteur (
      cle    TEXT PRIMARY KEY,
      valeur INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS etat_sync (
      cle    TEXT PRIMARY KEY,
      valeur TEXT
    );
  `);
}

/** Compteur local, incremente de maniere atomique. */
export function compteurSuivant(base: Database.Database, cle: string): number {
  const resultat = base
    .prepare(
      `INSERT INTO compteur (cle, valeur) VALUES (?, 1)
       ON CONFLICT(cle) DO UPDATE SET valeur = valeur + 1
       RETURNING valeur`,
    )
    .get(cle) as { valeur: number };
  return resultat.valeur;
}

export function lireEtat(base: Database.Database, cle: string): string | null {
  const ligne = base.prepare('SELECT valeur FROM etat_sync WHERE cle = ?').get(cle) as
    | { valeur: string | null }
    | undefined;
  return ligne?.valeur ?? null;
}

export function ecrireEtat(base: Database.Database, cle: string, valeur: string | null): void {
  base
    .prepare(
      `INSERT INTO etat_sync (cle, valeur) VALUES (?, ?)
       ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
    )
    .run(cle, valeur);
}
