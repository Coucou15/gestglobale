import { app, BrowserWindow, ipcMain } from 'electron';
import { join, dirname } from 'node:path';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createVerify } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ouvrirBase, lireEtat, ecrireEtat } from './base';
import { chercherParCode, chercherParTexte } from './catalogue';
import { encaisser, controlerCredit, type Panier, type ReglementSaisi } from './vente';
import { avantagesPour, promotionsEnCours } from './promotionsLocales';
import { articleParId } from './catalogue';
import {
  ouvrirSession, sessionOuverte, previsualiserCloture, cloturerSession,
} from './session';
import { Synchronisation, clientHttpParDefaut, CLE_JETON } from './synchronisation';
import { composerTicket, versEscPos, type EnteteTicket } from './impression';
import { BAREME_FIDELITE_DEFAUT, valeurDesPoints } from '@gestglobale/shared';
import type { ParametrageTimbre, TicketSync } from '@gestglobale/shared';
import { presenterBon } from './bons';

interface ConfigurationFichier {
  urlServeur: string;
  codeMagasin: string;
  numeroCaisse: number;
  cheminBase?: string;
  imprimante?: { peripherique?: string };
  entete: EnteteTicket;
}

let base: Database.Database;
let sync: Synchronisation;
let config: ConfigurationFichier;
let utilisateurCourant: { id: string; nom: string; permissions: string[] } | null = null;
let minuterieSync: NodeJS.Timeout | null = null;

function cheminConfig(): string {
  return process.env.GESTGLOBALE_CONFIG ?? join(app.getPath('userData'), 'caisse.json');
}

/**
 * Lit la configuration du poste, ou rend null a la premiere installation.
 *
 * Une caisse neuve ne doit pas s'arreter sur une erreur : l'installateur
 * qui en deploie trente a besoin d'un ecran, pas d'un fichier JSON a
 * editer a la main sur chaque machine.
 */
function chargerConfiguration(): ConfigurationFichier | null {
  const chemin = cheminConfig();
  if (!existsSync(chemin)) return null;
  try {
    return JSON.parse(readFileSync(chemin, 'utf8')) as ConfigurationFichier;
  } catch (erreur) {
    console.error(`Configuration illisible (${chemin}) :`, erreur);
    return null;
  }
}

/** Ecrit la configuration du poste et la rend. */
function enregistrerConfiguration(saisie: {
  urlServeur: string;
  codeMagasin: string;
  numeroCaisse: number;
  raisonSociale: string;
  adresse?: string;
  telephone?: string;
  rc?: string;
  nif?: string;
  nis?: string;
  articleImposition?: string;
  imprimante?: string;
}): ConfigurationFichier {
  const url = saisie.urlServeur.trim().replace(/\/+$/, '');
  const nouvelle: ConfigurationFichier = {
    urlServeur: url,
    codeMagasin: saisie.codeMagasin.trim().toUpperCase(),
    numeroCaisse: saisie.numeroCaisse,
    ...(saisie.imprimante ? { imprimante: { peripherique: saisie.imprimante.trim() } } : {}),
    entete: {
      raisonSociale: saisie.raisonSociale.trim(),
      adresse: saisie.adresse?.trim() || undefined,
      telephone: saisie.telephone?.trim() || undefined,
      rc: saisie.rc?.trim() || undefined,
      nif: saisie.nif?.trim() || undefined,
      nis: saisie.nis?.trim() || undefined,
      articleImposition: saisie.articleImposition?.trim() || undefined,
      codeMagasin: saisie.codeMagasin.trim().toUpperCase(),
      numeroCaisse: saisie.numeroCaisse,
      nomCaissier: '',
    },
  };
  mkdirSync(dirname(cheminConfig()), { recursive: true });
  writeFileSync(cheminConfig(), JSON.stringify(nouvelle, null, 2), 'utf8');
  return nouvelle;
}

function timbre(): ParametrageTimbre | undefined {
  const brut = base.prepare(`SELECT valeur FROM parametre WHERE cle = 'caisse.timbre'`).get() as
    | { valeur: string }
    | undefined;
  if (!brut) return undefined;
  try {
    return JSON.parse(brut.valeur) as ParametrageTimbre;
  } catch {
    return undefined;
  }
}

function plafondRemise(): number {
  const brut = base
    .prepare(`SELECT valeur FROM parametre WHERE cle = 'caisse.remise_plafond_pourcent'`)
    .get() as { valeur: string } | undefined;
  return brut ? Number(JSON.parse(brut.valeur)) || 0 : 0;
}

/**
 * Cadence de synchronisation.
 *
 * La section 4.1 demande une descente toutes les 1 a 5 minutes. La valeur
 * est descendue par le serveur et peut donc etre ajustee sans toucher aux
 * caisses installees.
 */
function demarrerBoucleSync(fenetre: BrowserWindow): void {
  const intervalle = () => {
    const brut = base
      .prepare(`SELECT valeur FROM parametre WHERE cle = 'caisse.intervalle_descente_secondes'`)
      .get() as { valeur: string } | undefined;
    const secondes = brut ? Number(JSON.parse(brut.valeur)) : 120;
    return Math.min(Math.max(secondes, 30), 300) * 1000;
  };

  const tour = async () => {
    try {
      await sync.cycle();
    } catch {
      // Hors ligne : c'est un etat normal, pas une erreur a remonter.
    }
    if (!fenetre.isDestroyed()) {
      fenetre.webContents.send('caisse:etat-sync-change', {
        ...sync.etat(),
        enAttente: sync.nombreEnAttente(),
      });
    }
    minuterieSync = setTimeout(tour, intervalle());
  };

  minuterieSync = setTimeout(tour, 2000);
}

function enregistrerCanaux(fenetre: BrowserWindow): void {
  ipcMain.handle('caisse:connexion', async (_evenement, { code, pin }) => {
    const poste = `${config.codeMagasin}-${config.numeroCaisse}`;
    const compterUtilisateurs = () =>
      (base.prepare('SELECT COUNT(*) AS n FROM utilisateur').get() as { n: number }).n;

    /**
     * Mise en service.
     *
     * Une caisse neuve n'a aucun utilisateur en base locale : ils
     * arrivent par la descente, qui exige un jeton, qui exige une
     * authentification. Sans passer par le serveur, une caisse qui sort
     * du carton ne pourrait donc jamais demarrer.
     *
     * On interroge donc toujours le serveur en premier. Son refus n'est
     * pas bloquant si la caisse connait deja l'utilisateur : c'est le
     * fonctionnement hors ligne, qui n'a de sens qu'une fois le poste
     * mis en service.
     */
    let reponseServeur: { jeton: string; utilisateur: { id: string; nom: string } } | null = null;
    let serveurJoignable = false;
    try {
      const reponse = await fetch(`${config.urlServeur}/auth/connexion-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, pin, poste }),
        signal: AbortSignal.timeout(8000),
      });
      serveurJoignable = reponse.status !== 0;
      if (reponse.ok) {
        reponseServeur = (await reponse.json()) as typeof reponseServeur;
        ecrireEtat(base, CLE_JETON, reponseServeur!.jeton);
      } else if (reponse.status === 401 || reponse.status === 403) {
        // Le serveur a tranche : inutile de retomber sur la copie locale,
        // qui pourrait etre perimee et accepter un compte desactive.
        const corps = (await reponse.json().catch(() => ({}))) as { message?: string };
        return { ok: false, message: corps.message ?? 'Code ou PIN incorrect' };
      }
    } catch {
      // Serveur injoignable : on poursuit hors ligne.
      serveurJoignable = false;
    }

    // Premiere mise en service : les utilisateurs et le catalogue
    // descendent maintenant, avec le jeton qu'on vient d'obtenir.
    if (reponseServeur && compterUtilisateurs() === 0) {
      try {
        await sync.descendre();
      } catch (erreur) {
        console.error('Descente initiale incomplete :', erreur);
      }
    }

    const utilisateur = base
      .prepare('SELECT * FROM utilisateur WHERE code = ? AND actif = 1')
      .get(code) as
      | { id: string; nom: string; empreinte_pin: string; permissions: string }
      | undefined;

    if (!utilisateur) {
      if (!serveurJoignable && compterUtilisateurs() === 0) {
        return {
          ok: false,
          message:
            'Premiere mise en service : le serveur doit etre joignable une fois, ' +
            'le temps de recuperer le catalogue et les utilisateurs.',
        };
      }
      if (reponseServeur) {
        // Le serveur a reconnu l'utilisateur mais la descente n'a rien
        // rapporte : on refuse plutot que d'ouvrir une caisse sans droits.
        return {
          ok: false,
          message: 'Utilisateur reconnu, mais le catalogue n\u2019a pas pu etre recupere.',
        };
      }
      return { ok: false, message: 'Code inconnu' };
    }

    // Hors ligne, l'empreinte descendue fait foi. En ligne, le serveur a
    // deja tranche : on ne redemande pas la meme preuve deux fois.
    if (!reponseServeur) {
      let correct = false;
      try {
        const argon2 = await import('argon2');
        correct = await argon2.verify(utilisateur.empreinte_pin, pin);
      } catch {
        correct = false;
      }
      if (!correct) return { ok: false, message: 'Code ou PIN incorrect' };
    }

    utilisateurCourant = {
      id: utilisateur.id,
      nom: utilisateur.nom,
      permissions: JSON.parse(utilisateur.permissions) as string[],
    };

    return {
      ok: true,
      utilisateur: utilisateurCourant,
      plafondRemise: plafondRemise(),
      horsLigne: !reponseServeur,
    };
  });

  ipcMain.handle('caisse:etat-sync', () => ({
    ...sync.etat(),
    enAttente: sync.nombreEnAttente(),
    bloques: sync.elementsBloques(),
  }));

  ipcMain.handle('caisse:synchroniser', () => sync.cycle());

  ipcMain.handle('caisse:session-courante', () => sessionOuverte(base));

  ipcMain.handle('caisse:ouvrir-session', (_e, { fondDeCaisseCentimes }) => {
    if (!utilisateurCourant) throw new Error('Connectez-vous d’abord');
    return ouvrirSession(base, {
      codeMagasin: config.codeMagasin,
      numeroCaisse: config.numeroCaisse,
      fondDeCaisseCentimes,
      utilisateurId: utilisateurCourant.id,
      horsLigne: sync.etat().couleur !== 'vert',
    });
  });

  ipcMain.handle('caisse:previsualiser-cloture', (_e, { comptage }) => {
    const session = sessionOuverte(base);
    if (!session) throw new Error('Aucune session ouverte');
    return previsualiserCloture(base, session.numero, comptage);
  });

  ipcMain.handle('caisse:cloturer', (_e, { comptage, justification }) => {
    if (!utilisateurCourant) throw new Error('Connectez-vous d’abord');
    const session = sessionOuverte(base);
    if (!session) throw new Error('Aucune session ouverte');
    return cloturerSession(base, {
      sessionNumero: session.numero,
      comptage,
      justification,
      utilisateurId: utilisateurCourant.id,
      horsLigne: sync.etat().couleur !== 'vert',
    });
  });

  ipcMain.handle('caisse:chercher-code', (_e, { code }) => chercherParCode(base, code));

  /**
   * Avantages promotionnels d'une ligne.
   *
   * Appele a chaque changement de quantite : un « trois pour deux » ne se
   * declenche qu'au troisieme article et doit disparaitre si le caissier
   * revient a deux. Le calcul se fait sur la base locale, donc sans
   * reseau.
   */
  ipcMain.handle(
    'caisse:promotions-ligne',
    (_e, { articleId, quantiteMilli, prixUnitaireCentimes }) => {
      const article = articleParId(base, articleId);
      if (!article) return [];
      return avantagesPour(base, article, quantiteMilli, prixUnitaireCentimes);
    },
  );

  ipcMain.handle('caisse:promotions-en-cours', () => promotionsEnCours(base));

  /** Presente un bon d'achat pour un montant : la caisse dit s'il couvre. */
  ipcMain.handle('caisse:presenter-bon', (_e, { code, montantCentimes }) =>
    presenterBon(base, code, montantCentimes),
  );

  /** Points de fidelite connus d'un client, et leur valeur en dinars. */
  ipcMain.handle('caisse:points-client', (_e, { clientId }) => {
    const client = base
      .prepare('SELECT points_fidelite AS points FROM client WHERE id = ?')
      .get(clientId) as { points: number } | undefined;
    const brut = base
      .prepare(`SELECT valeur FROM parametre WHERE cle = 'caisse.fidelite'`)
      .get() as { valeur: string } | undefined;
    const bareme = brut
      ? { ...BAREME_FIDELITE_DEFAUT, ...JSON.parse(brut.valeur) }
      : BAREME_FIDELITE_DEFAUT;
    const points = client?.points ?? 0;
    return { points, valeurCentimes: valeurDesPoints(points, bareme), bareme };
  });
  ipcMain.handle('caisse:chercher-texte', (_e, { texte }) => chercherParTexte(base, texte));

  ipcMain.handle('caisse:chercher-client', (_e, { texte }) => {
    const motif = `%${texte}%`;
    return base
      .prepare(
        `SELECT id, code, nom, categorie_prix AS categoriePrix, remise_pourcent AS remisePourcent,
                plafond_credit_centimes AS plafondCreditCentimes, solde_centimes AS soldeCentimes,
                bloque, carte_fidelite AS carteFidelite, points_fidelite AS pointsFidelite
           FROM client
          WHERE nom LIKE ? OR code LIKE ? OR carte_fidelite = ?
          LIMIT 20`,
      )
      .all(motif, motif, texte);
  });

  ipcMain.handle('caisse:controler-credit', (_e, { clientId, montantCentimes }) =>
    controlerCredit(base, clientId, montantCentimes),
  );

  ipcMain.handle('caisse:encaisser', (_e, { panier, reglements }) => {
    if (!utilisateurCourant) throw new Error('Connectez-vous d’abord');
    const session = sessionOuverte(base);
    if (!session) throw new Error('Ouvrez une session de caisse avant de vendre');

    const etat = sync.etat();
    const resultat = encaisser(base, panier as Panier, reglements as ReglementSaisi[], {
      codeMagasin: config.codeMagasin,
      numeroCaisse: config.numeroCaisse,
      sessionNumero: session.numero,
      utilisateurId: utilisateurCourant.id,
      horsLigne: etat.couleur !== 'vert',
      timbre: timbre(),
      // Au-dela de 24 h sans synchronisation, les prix appliques peuvent
      // ne plus etre ceux du siege : le ticket est signale (section 4.4).
      prixPerime: etat.couleur === 'rouge',
    });

    // Envoi immediat tente en arriere-plan ; l'echec est sans consequence,
    // le ticket est deja en file.
    void sync.remonter().catch(() => undefined);
    void fenetre;
    return resultat;
  });

  ipcMain.handle('caisse:imprimer', (_e, { numero }) => {
    const ticket = reconstituerTicket(numero);
    const texte = composerTicket(ticket, {
      ...config.entete,
      nomCaissier: utilisateurCourant?.nom ?? '',
    });
    const octets = versEscPos(texte, { ouvrirTiroir: true });
    envoyerImprimante(octets);
    return { texte };
  });

  ipcMain.handle('caisse:ouvrir-tiroir', () => {
    envoyerImprimante(versEscPos('', { ouvrirTiroir: true }));
    return { ok: true };
  });
}

function reconstituerTicket(numero: string): TicketSync {
  const enFile = base
    .prepare(`SELECT charge FROM file_envoi WHERE type = 'TICKET' AND reference = ?`)
    .get(numero) as { charge: string } | undefined;
  if (enFile) return JSON.parse(enFile.charge) as TicketSync;

  const entete = base.prepare('SELECT * FROM ticket WHERE numero = ?').get(numero) as
    | Record<string, unknown>
    | undefined;
  if (!entete) throw new Error(`Ticket introuvable : ${numero}`);

  const lignes = base
    .prepare('SELECT * FROM ligne_ticket WHERE ticket_numero = ? ORDER BY numero_ligne')
    .all(numero) as Array<Record<string, unknown>>;
  const reglements = base
    .prepare('SELECT * FROM reglement WHERE ticket_numero = ?')
    .all(numero) as Array<Record<string, unknown>>;

  return {
    numero,
    sessionCaisseNumero: entete.session_numero as string,
    type: 'VENTE',
    dateVente: entete.date_vente as string,
    utilisateurId: entete.utilisateur_id as string,
    clientId: (entete.client_id as string) ?? null,
    lignes: lignes.map((l) => ({
      numeroLigne: l.numero_ligne as number,
      articleId: l.article_id as string,
      codeScanne: (l.code_scanne as string) ?? null,
      designation: l.designation as string,
      quantiteMilli: l.quantite_milli as number,
      prixUnitaireCentimes: l.prix_unitaire_centimes as number,
      remisePourcent: l.remise_pourcent as number,
      remiseCentimes: l.remise_centimes as number,
      tauxTva: l.taux_tva as number,
      totalHtCentimes: l.total_ht_centimes as number,
      totalTtcCentimes: l.total_ttc_centimes as number,
      cumpCentimes: l.cump_centimes as number,
      annulee: (l.annulee as number) === 1,
      autoriseeParUtilisateurId: (l.autorisee_par_id as string) ?? null,
      promotionId: (l.promotion_id as string) ?? null,
    })),
    reglements: reglements.map((r) => ({
      mode: r.mode as TicketSync['reglements'][number]['mode'],
      montantCentimes: r.montant_centimes as number,
      reference: (r.reference as string) ?? null,
    })),
    totalHtCentimes: entete.total_ht_centimes as number,
    totalTvaCentimes: entete.total_tva_centimes as number,
    timbreCentimes: entete.timbre_centimes as number,
    totalTtcCentimes: entete.total_ttc_centimes as number,
    remisePiedCentimes: entete.remise_pied_centimes as number,
    renduCentimes: entete.rendu_centimes as number,
    horsLigne: (entete.hors_ligne as number) === 1,
    prixPerime: (entete.prix_perime as number) === 1,
    ticketOrigineNumero: null,
    forcageSuperviseurId: (entete.forcage_superviseur_id as string) ?? null,
  };
}

function envoyerImprimante(octets: Buffer): void {
  const peripherique = config.imprimante?.peripherique;
  if (!peripherique) return;
  try {
    writeFileSync(peripherique, octets);
  } catch (erreur) {
    // Une imprimante absente ou occupee ne doit jamais empecher la vente :
    // le ticket existe deja en base et peut etre reimprime.
    console.error('Impression impossible :', erreur);
  }
  void createVerify;
}

function creerFenetre(): BrowserWindow {
  const fenetre = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: process.env.CAISSE_FENETRE !== 'true',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const developpement = process.env.VITE_DEV_SERVER_URL;
  if (developpement) void fenetre.loadURL(developpement);
  else void fenetre.loadFile(join(__dirname, '../rendu/index.html'));

  return fenetre;
}

/** Ouvre la base locale et la synchronisation pour la configuration donnee. */
function initialiser(fenetre: BrowserWindow): void {
  base = ouvrirBase(
    config.cheminBase ?? join(app.getPath('userData'), 'donnees', 'caisse.db'),
  );
  sync = new Synchronisation(
    base,
    {
      urlServeur: config.urlServeur,
      codeMagasin: config.codeMagasin,
      numeroCaisse: config.numeroCaisse,
    },
    clientHttpParDefaut(config.urlServeur),
  );
  demarrerBoucleSync(fenetre);
}

void app.whenReady().then(() => {
  const chargee = chargerConfiguration();
  const fenetre = creerFenetre();

  // Les canaux de configuration existent avant tout : c'est par eux que
  // passe la premiere installation.
  ipcMain.handle('caisse:configuration', () =>
    config
      ? {
          configuree: true,
          urlServeur: config.urlServeur,
          codeMagasin: config.codeMagasin,
          numeroCaisse: config.numeroCaisse,
          entete: config.entete,
          chemin: cheminConfig(),
        }
      : { configuree: false, chemin: cheminConfig() },
  );

  ipcMain.handle('caisse:tester-serveur', async (_evenement, { urlServeur }) => {
    try {
      const reponse = await fetch(`${String(urlServeur).replace(/\/+$/, '')}/auth/moi`, {
        signal: AbortSignal.timeout(6000),
      });
      // 401 est la bonne reponse : le serveur repond et refuse un appel
      // sans jeton, ce qui prouve qu'il s'agit bien de GestGlobale.
      return reponse.status === 401
        ? { joignable: true }
        : { joignable: false, message: `Reponse inattendue du serveur (${reponse.status})` };
    } catch (erreur) {
      return {
        joignable: false,
        message:
          erreur instanceof Error && erreur.name === 'TimeoutError'
            ? 'Le serveur ne repond pas dans le delai imparti'
            : 'Serveur injoignable : verifiez l\u2019adresse et le reseau',
      };
    }
  });

  ipcMain.handle('caisse:enregistrer-configuration', (_evenement, saisie) => {
    config = enregistrerConfiguration(saisie);
    initialiser(fenetre);
    enregistrerCanaux(fenetre);
    return { configuree: true };
  });

  if (chargee) {
    config = chargee;
    initialiser(fenetre);
    enregistrerCanaux(fenetre);
  }

  void lireEtat;
});

app.on('window-all-closed', () => {
  if (minuterieSync) clearTimeout(minuterieSync);
  base?.close();
  if (process.platform !== 'darwin') app.quit();
});
