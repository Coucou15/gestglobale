import type Database from 'better-sqlite3';
import { compteurSuivant, ecrireEtat, lireEtat } from './base';
import {
  VERSION_PROTOCOLE_SYNC, etatConnexion,
  type DemandeDescente, type ReponseDescente, type DemandeRemontee,
  type ReponseRemontee, type TicketSync, type ClotureSync, type MouvementCaisseSync,
  type SessionSync,
} from '@gestglobale/shared';

export const CLE_CURSEUR = 'curseur.descente';
export const CLE_DERNIERE_REUSSITE = 'sync.derniere_reussite';
export const CLE_JETON = 'sync.jeton';

/** Nombre maximal d'elements envoyes en une fois, pour ne pas saturer. */
const LOT_REMONTEE = 100;

/** En deca, inutile de reduire davantage : le probleme est ailleurs. */
const LOT_MINIMAL = 1;

export interface ConfigurationCaisse {
  urlServeur: string;
  codeMagasin: string;
  numeroCaisse: number;
}

export interface ClientHttp {
  poster<T>(chemin: string, corps: unknown, jeton: string | null): Promise<T>;
}

/** Client HTTP par defaut, avec delai d'attente court : hors ligne, on n'attend pas. */
export function clientHttpParDefaut(urlBase: string, delaiMs = 8000): ClientHttp {
  return {
    async poster<T>(chemin: string, corps: unknown, jeton: string | null): Promise<T> {
      const controleur = new AbortController();
      const minuterie = setTimeout(() => controleur.abort(), delaiMs);
      try {
        const reponse = await fetch(`${urlBase}${chemin}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
          },
          body: JSON.stringify(corps),
          signal: controleur.signal,
        });
        if (!reponse.ok) {
          throw new Error(`Serveur ${reponse.status} : ${await reponse.text()}`);
        }
        return (await reponse.json()) as T;
      } finally {
        clearTimeout(minuterie);
      }
    },
  };
}

export class Synchronisation {
  /**
   * File d'execution des synchronisations.
   *
   * Deux remontees peuvent partir en meme temps : celle que declenche
   * l'encaissement d'un ticket, et celle de la boucle periodique. Elles
   * liraient alors la meme file et enverraient les memes elements, et
   * surtout elles pourraient presenter un ticket avant la session a
   * laquelle il se rattache — le serveur le refuserait, et il resterait
   * bloque en file alors que rien ne cloche.
   *
   * Les synchronisations passent donc l'une apres l'autre.
   */
  private file: Promise<unknown> = Promise.resolve();

  private enfiler<T>(action: () => Promise<T>): Promise<T> {
    const courant = this.file.catch(() => undefined).then(action);
    this.file = courant.catch(() => undefined);
    return courant;
  }

  constructor(
    private readonly base: Database.Database,
    private readonly config: ConfigurationCaisse,
    private readonly http: ClientHttp,
  ) {}

  private jeton(): string | null {
    return lireEtat(this.base, CLE_JETON);
  }

  /** Etat du voyant de la caisse : vert, orange ou rouge (section 4.6). */
  etat() {
    const derniere = lireEtat(this.base, CLE_DERNIERE_REUSSITE);
    const enAttente = this.nombreEnAttente();
    return etatConnexion({
      derniereSyncReussie: derniere ? new Date(derniere) : null,
      ticketsEnAttente: enAttente,
    });
  }

  /** Tickets restant a envoyer : c'est ce que le voyant orange annonce. */
  nombreEnAttente(): number {
    const ligne = this.base
      .prepare(`SELECT COUNT(*) AS n FROM file_envoi WHERE type = 'TICKET'`)
      .get() as { n: number };
    return ligne.n;
  }

  /**
   * DESCENTE : recupere les modifications du serveur et les applique a la
   * base locale. Les pages s'enchainent tant que le serveur en annonce.
   */
  async descendre(): Promise<{ articles: number; clients: number; pages: number }> {
    return this.enfiler(() => this.descendreMaintenant());
  }

  private async descendreMaintenant(): Promise<{
    articles: number; clients: number; pages: number;
  }> {
    let curseur = lireEtat(this.base, CLE_CURSEUR);
    let articles = 0;
    let clients = 0;
    let pages = 0;

    for (;;) {
      const demande: DemandeDescente = {
        versionProtocole: VERSION_PROTOCOLE_SYNC,
        codeMagasin: this.config.codeMagasin,
        numeroCaisse: this.config.numeroCaisse,
        curseur,
      };
      const reponse = await this.http.poster<ReponseDescente>(
        '/sync/descente',
        demande,
        this.jeton(),
      );

      this.appliquerDescente(reponse);
      articles += reponse.articles.length;
      clients += reponse.clients.length;
      pages += 1;
      curseur = reponse.curseur;

      if (!reponse.autresPages) break;
      // Garde-fou : on ne boucle pas indefiniment si le serveur se trompe.
      if (pages >= 200) break;
    }

    ecrireEtat(this.base, CLE_CURSEUR, curseur);
    return { articles, clients, pages };
  }

  /** Applique une page de descente dans une transaction unique. */
  appliquerDescente(reponse: ReponseDescente): void {
    const maintenant = new Date().toISOString();

    const transaction = this.base.transaction(() => {
      const majArticle = this.base.prepare(
        `INSERT INTO article (id, reference, designation, designation_ar, unite, decimales,
            taux_tva, prix_detail_centimes, prix_gros_centimes, prix_cat3_centimes,
            prix_cat4_centimes, prix_cat5_centimes, cump_centimes, pack_de_id,
            pack_nb_unites, est_vrac, vente_autorisee, archive, rayon_id, famille_id,
            stock_sv_milli, descendu_le)
         VALUES (@id,@reference,@designation,@designationAr,@unite,@decimales,@tauxTva,
            @prixDetail,@prixGros,@prixCat3,@prixCat4,@prixCat5,@cump,@packDeId,
            @packNbUnites,@estVrac,@venteAutorisee,@archive,@rayonId,@familleId,
            @stockSv,@descenduLe)
         ON CONFLICT(id) DO UPDATE SET
            reference=excluded.reference, designation=excluded.designation,
            designation_ar=excluded.designation_ar, unite=excluded.unite,
            decimales=excluded.decimales, taux_tva=excluded.taux_tva,
            prix_detail_centimes=excluded.prix_detail_centimes,
            prix_gros_centimes=excluded.prix_gros_centimes,
            prix_cat3_centimes=excluded.prix_cat3_centimes,
            prix_cat4_centimes=excluded.prix_cat4_centimes,
            prix_cat5_centimes=excluded.prix_cat5_centimes,
            cump_centimes=excluded.cump_centimes, pack_de_id=excluded.pack_de_id,
            pack_nb_unites=excluded.pack_nb_unites, est_vrac=excluded.est_vrac,
            vente_autorisee=excluded.vente_autorisee, archive=excluded.archive,
            rayon_id=excluded.rayon_id, famille_id=excluded.famille_id,
            stock_sv_milli=excluded.stock_sv_milli, descendu_le=excluded.descendu_le`,
      );
      const viderCodes = this.base.prepare('DELETE FROM code_barre WHERE article_id = ?');
      const insererCode = this.base.prepare(
        `INSERT INTO code_barre (code, article_id) VALUES (?, ?)
         ON CONFLICT(code) DO UPDATE SET article_id = excluded.article_id`,
      );

      for (const a of reponse.articles) {
        majArticle.run({
          id: a.id, reference: a.reference, designation: a.designation,
          designationAr: a.designationAr, unite: a.unite, decimales: a.decimales,
          tauxTva: a.tauxTva, prixDetail: a.prixDetailCentimes, prixGros: a.prixGrosCentimes,
          prixCat3: a.prixCat3Centimes, prixCat4: a.prixCat4Centimes,
          prixCat5: a.prixCat5Centimes, cump: a.cumpCentimes, packDeId: a.packDeId,
          packNbUnites: a.packNbUnites, estVrac: a.estVrac ? 1 : 0,
          venteAutorisee: a.venteAutorisee ? 1 : 0, archive: a.archive ? 1 : 0,
          rayonId: a.rayonId, familleId: a.familleId, stockSv: a.stockSvMilli,
          descenduLe: maintenant,
        });
        viderCodes.run(a.id);
        for (const code of a.codesBarres) insererCode.run(code, a.id);
      }

      const majClient = this.base.prepare(
        `INSERT INTO client (id, code, nom, categorie_prix, remise_pourcent,
            plafond_credit_centimes, solde_centimes, bloque, motif_blocage,
            carte_fidelite, points_fidelite, descendu_le)
         VALUES (@id,@code,@nom,@categorie,@remise,@plafond,@solde,@bloque,@motif,
            @carte,@points,@descenduLe)
         ON CONFLICT(id) DO UPDATE SET
            code=excluded.code, nom=excluded.nom, categorie_prix=excluded.categorie_prix,
            remise_pourcent=excluded.remise_pourcent,
            plafond_credit_centimes=excluded.plafond_credit_centimes,
            solde_centimes=excluded.solde_centimes, bloque=excluded.bloque,
            motif_blocage=excluded.motif_blocage, carte_fidelite=excluded.carte_fidelite,
            points_fidelite=excluded.points_fidelite, descendu_le=excluded.descendu_le`,
      );
      for (const cl of reponse.clients) {
        majClient.run({
          id: cl.id, code: cl.code, nom: cl.nom, categorie: cl.categoriePrix,
          remise: cl.remisePourcent, plafond: cl.plafondCreditCentimes,
          solde: cl.soldeCentimes, bloque: cl.bloque ? 1 : 0, motif: cl.motifBlocage,
          carte: cl.carteFidelite, points: cl.pointsFidelite, descenduLe: maintenant,
        });
      }

      const majPromotion = this.base.prepare(
        `INSERT INTO promotion (id, libelle, type, debut, fin, article_id, famille_id,
            valeur_centimes, remise_pourcent, quantite_declenchement, quantite_offerte,
            heure_debut, heure_fin, cumulable)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
            libelle=excluded.libelle, type=excluded.type, debut=excluded.debut,
            fin=excluded.fin, article_id=excluded.article_id, famille_id=excluded.famille_id,
            valeur_centimes=excluded.valeur_centimes, remise_pourcent=excluded.remise_pourcent,
            quantite_declenchement=excluded.quantite_declenchement,
            quantite_offerte=excluded.quantite_offerte, heure_debut=excluded.heure_debut,
            heure_fin=excluded.heure_fin`,
      );
      for (const p of reponse.promotions) {
        majPromotion.run(
          p.id, p.libelle, p.type, p.debut, p.fin, p.articleId, p.familleId,
          p.valeurCentimes, p.remisePourcent, p.quantiteDeclenchement, p.quantiteOfferte,
          p.heureDebut, p.heureFin, p.cumulable ? 1 : 0,
        );
      }

      const majUtilisateur = this.base.prepare(
        `INSERT INTO utilisateur (id, code, nom, role, empreinte_pin, permissions, actif)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
            code=excluded.code, nom=excluded.nom, role=excluded.role,
            empreinte_pin=excluded.empreinte_pin, permissions=excluded.permissions,
            actif=excluded.actif`,
      );
      for (const u of reponse.utilisateurs) {
        majUtilisateur.run(
          u.id, u.code, u.nom, u.role, u.empreintePin,
          JSON.stringify(u.permissions), u.actif ? 1 : 0,
        );
      }

      const majBon = this.base.prepare(
        `INSERT INTO bon_achat (code, type, solde_centimes, expire_le, actif, descendu_le)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(code) DO UPDATE SET
            type=excluded.type, solde_centimes=excluded.solde_centimes,
            expire_le=excluded.expire_le, actif=excluded.actif,
            descendu_le=excluded.descendu_le`,
      );
      for (const bon of reponse.bons ?? []) {
        majBon.run(
          bon.code, bon.type, bon.soldeCentimes, bon.expireLe,
          bon.actif ? 1 : 0, maintenant,
        );
      }

      const majParametre = this.base.prepare(
        `INSERT INTO parametre (cle, valeur) VALUES (?, ?)
         ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
      );
      for (const [cle, valeur] of Object.entries(reponse.parametres ?? {})) {
        majParametre.run(cle, JSON.stringify(valeur));
      }

      // Entites retirees : un article supprime au siege ne doit plus etre
      // vendable en caisse.
      for (const id of reponse.supprimes.articles) {
        this.base.prepare('UPDATE article SET vente_autorisee = 0, archive = 1 WHERE id = ?').run(id);
      }
      for (const id of reponse.supprimes.clients) {
        this.base.prepare('DELETE FROM client WHERE id = ?').run(id);
      }
      for (const id of reponse.supprimes.promotions) {
        this.base.prepare('DELETE FROM promotion WHERE id = ?').run(id);
      }
      for (const id of reponse.supprimes.utilisateurs) {
        this.base.prepare('UPDATE utilisateur SET actif = 0 WHERE id = ?').run(id);
      }
      for (const code of reponse.supprimes.bons ?? []) {
        this.base.prepare('UPDATE bon_achat SET actif = 0 WHERE code = ?').run(code);
      }
    });

    transaction();
  }

  /**
   * REMONTEE : envoie la file au serveur et ne retire un element QUE sur
   * accuse de reception (section 4.2).
   *
   * Un element refuse reste en file avec son motif, consultable par le
   * gerant : rien n'est perdu silencieusement.
   */
  async remonter(limite = LOT_REMONTEE): Promise<{
    envoyes: number;
    acceptes: number;
    dejaRecus: number;
    refuses: number;
  }> {
    return this.enfiler(() => this.remonterMaintenant(limite));
  }

  private async remonterMaintenant(limite = LOT_REMONTEE): Promise<{
    envoyes: number;
    acceptes: number;
    dejaRecus: number;
    refuses: number;
  }> {
    const elements = this.base
      .prepare(
        `SELECT id, type, reference, charge FROM file_envoi
          ORDER BY id LIMIT ?`,
      )
      .all(limite) as Array<{ id: number; type: string; reference: string; charge: string }>;

    if (elements.length === 0) {
      ecrireEtat(this.base, CLE_DERNIERE_REUSSITE, new Date().toISOString());
      return { envoyes: 0, acceptes: 0, dejaRecus: 0, refuses: 0 };
    }

    const sessions: SessionSync[] = [];
    const tickets: TicketSync[] = [];
    const clotures: ClotureSync[] = [];
    const mouvements: MouvementCaisseSync[] = [];
    for (const element of elements) {
      const charge = JSON.parse(element.charge);
      if (element.type === 'SESSION') sessions.push(charge);
      else if (element.type === 'TICKET') tickets.push(charge);
      else if (element.type === 'CLOTURE') clotures.push(charge);
      else mouvements.push(charge);
    }

    const demande: DemandeRemontee = {
      versionProtocole: VERSION_PROTOCOLE_SYNC,
      codeMagasin: this.config.codeMagasin,
      numeroCaisse: this.config.numeroCaisse,
      sessions,
      tickets,
      clotures,
      mouvements,
    };

    let reponse: ReponseRemontee;
    try {
      reponse = await this.http.poster<ReponseRemontee>('/sync/remontee', demande, this.jeton());
    } catch (erreur) {
      const message = erreur instanceof Error ? erreur.message : String(erreur);

      // Charge trop volumineuse pour le serveur ou un equipement
      // intermediaire : on reessaie avec un lot deux fois plus petit
      // plutot que de laisser la file bloquee pour toujours.
      if (/\b413\b|entity too large/i.test(message) && limite > LOT_MINIMAL) {
        // On reste dans la meme execution : repasser par `remonter`
        // attendrait une file dont on est soi-meme le maillon courant.
        return this.remonterMaintenant(Math.max(LOT_MINIMAL, Math.floor(limite / 2)));
      }

      // Echec reseau : rien n'est retire de la file, on note la tentative.
      const marquer = this.base.prepare(
        `UPDATE file_envoi
            SET tentatives = tentatives + 1, derniere_erreur = ?, derniere_tentative = ?
          WHERE id = ?`,
      );
      const maintenant = new Date().toISOString();
      this.base.transaction(() => {
        for (const element of elements) marquer.run(message, maintenant, element.id);
      })();
      throw erreur;
    }

    let acceptes = 0;
    let dejaRecus = 0;
    let refuses = 0;

    const retirer = this.base.prepare('DELETE FROM file_envoi WHERE type = ? AND reference = ?');
    const marquerRefus = this.base.prepare(
      `UPDATE file_envoi
          SET tentatives = tentatives + 1, derniere_erreur = ?, derniere_tentative = ?
        WHERE type = ? AND reference = ?`,
    );
    const maintenant = new Date().toISOString();

    const traiter = (type: string, accuses: ReponseRemontee['tickets']) => {
      for (const accuse of accuses) {
        if (accuse.statut === 'ACCEPTE') {
          retirer.run(type, accuse.numero);
          acceptes++;
        } else if (accuse.statut === 'DEJA_RECU') {
          // Le serveur l'avait deja : l'accuse precedent s'etait perdu.
          retirer.run(type, accuse.numero);
          dejaRecus++;
        } else {
          marquerRefus.run(accuse.erreur ?? 'Refuse par le serveur', maintenant, type, accuse.numero);
          refuses++;
        }
      }
    };

    this.base.transaction(() => {
      traiter('SESSION', reponse.sessions ?? []);
      traiter('TICKET', reponse.tickets);
      traiter('CLOTURE', reponse.clotures);
      traiter('MOUVEMENT', reponse.mouvements);
    })();

    ecrireEtat(this.base, CLE_DERNIERE_REUSSITE, maintenant);
    return { envoyes: elements.length, acceptes, dejaRecus, refuses };
  }

  /** Un cycle complet : descente puis remontee, chacune independante. */
  async cycle(): Promise<{
    descente: { ok: boolean; erreur?: string };
    remontee: { ok: boolean; erreur?: string; acceptes?: number };
  }> {
    const resultat: {
      descente: { ok: boolean; erreur?: string };
      remontee: { ok: boolean; erreur?: string; acceptes?: number };
    } = { descente: { ok: false }, remontee: { ok: false } };

    try {
      await this.descendre();
      resultat.descente.ok = true;
    } catch (erreur) {
      resultat.descente.erreur = erreur instanceof Error ? erreur.message : String(erreur);
    }

    try {
      const r = await this.remonter();
      resultat.remontee.ok = true;
      resultat.remontee.acceptes = r.acceptes + r.dejaRecus;
    } catch (erreur) {
      resultat.remontee.erreur = erreur instanceof Error ? erreur.message : String(erreur);
    }

    return resultat;
  }

  /** Elements bloques en file, a montrer au gerant. */
  elementsBloques(minTentatives = 3) {
    return this.base
      .prepare(
        `SELECT type, reference, tentatives, derniere_erreur, cree_le
           FROM file_envoi WHERE tentatives >= ? ORDER BY id`,
      )
      .all(minTentatives);
  }

  /** Reference locale unique pour un mouvement de caisse. */
  referenceMouvement(): string {
    const compteur = compteurSuivant(
      this.base,
      `MOUVEMENT.${this.config.codeMagasin}.${this.config.numeroCaisse}`,
    );
    return `MVC-${this.config.codeMagasin}-${String(this.config.numeroCaisse).padStart(2, '0')}-${String(compteur).padStart(6, '0')}`;
  }
}
