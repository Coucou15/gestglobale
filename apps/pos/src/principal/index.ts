import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createVerify } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ouvrirBase, lireEtat, ecrireEtat } from './base';
import { chercherParCode, chercherParTexte } from './catalogue';
import { encaisser, controlerCredit, type Panier, type ReglementSaisi } from './vente';
import {
  ouvrirSession, sessionOuverte, previsualiserCloture, cloturerSession,
} from './session';
import { Synchronisation, clientHttpParDefaut, CLE_JETON } from './synchronisation';
import { composerTicket, versEscPos, type EnteteTicket } from './impression';
import type { ParametrageTimbre, TicketSync } from '@gestglobale/shared';

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

function chargerConfiguration(): ConfigurationFichier {
  const chemin = cheminConfig();
  if (!existsSync(chemin)) {
    // Premiere installation : on depose un gabarit a completer par
    // l'installateur plutot que de demarrer sur des valeurs inventees.
    const gabarit: ConfigurationFichier = {
      urlServeur: 'http://192.168.1.10:3000/api/v1',
      codeMagasin: 'SV',
      numeroCaisse: 1,
      entete: {
        raisonSociale: 'A completer',
        codeMagasin: 'SV',
        numeroCaisse: 1,
        nomCaissier: '',
      },
    };
    writeFileSync(chemin, JSON.stringify(gabarit, null, 2), 'utf8');
    throw new Error(
      `Configuration absente. Un gabarit a ete ecrit dans ${chemin} : completez-le puis relancez la caisse.`,
    );
  }
  return JSON.parse(readFileSync(chemin, 'utf8')) as ConfigurationFichier;
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
    // Hors ligne, la caisse authentifie sur l'empreinte descendue : c'est
    // ce qui permet de prendre son poste sans reseau.
    const utilisateur = base
      .prepare('SELECT * FROM utilisateur WHERE code = ? AND actif = 1')
      .get(code) as
      | { id: string; nom: string; empreinte_pin: string; permissions: string }
      | undefined;

    if (!utilisateur) return { ok: false, message: 'Code inconnu' };

    let correct = false;
    try {
      const argon2 = await import('argon2');
      correct = await argon2.verify(utilisateur.empreinte_pin, pin);
    } catch {
      correct = false;
    }
    if (!correct) return { ok: false, message: 'Code ou PIN incorrect' };

    utilisateurCourant = {
      id: utilisateur.id,
      nom: utilisateur.nom,
      permissions: JSON.parse(utilisateur.permissions) as string[],
    };

    // En ligne, on obtient aussi un jeton serveur pour la synchronisation.
    try {
      const reponse = await fetch(`${config.urlServeur}/auth/connexion-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, pin, poste: `${config.codeMagasin}-${config.numeroCaisse}` }),
      });
      if (reponse.ok) {
        const donnees = (await reponse.json()) as { jeton: string };
        ecrireEtat(base, CLE_JETON, donnees.jeton);
      }
    } catch {
      // Sans reseau on garde le jeton precedent ; il resservira au retour.
    }

    return { ok: true, utilisateur: utilisateurCourant, plafondRemise: plafondRemise() };
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

void app.whenReady().then(() => {
  config = chargerConfiguration();
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

  const fenetre = creerFenetre();
  enregistrerCanaux(fenetre);
  demarrerBoucleSync(fenetre);

  void lireEtat;
});

app.on('window-all-closed', () => {
  if (minuterieSync) clearTimeout(minuterieSync);
  base?.close();
  if (process.platform !== 'darwin') app.quit();
});
