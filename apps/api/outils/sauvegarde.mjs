#!/usr/bin/env node
/**
 * Sauvegarde chiffree de la base centrale.
 *
 *   node apps/api/outils/sauvegarde.mjs
 *
 * Ecrit un fichier chiffre dans le dossier local, en depose une copie
 * hors site si un second dossier est configure, puis efface les
 * sauvegardes plus vieilles que la retention.
 *
 * Pourquoi en Node plutot qu'en script shell : le serveur du client est
 * sous Windows Server, ou ni openssl ni gpg ne sont garantis. Node, lui,
 * y tourne deja — c'est ce qui fait tourner GestGlobale. Le seul outil
 * externe est pg_dump, livre avec PostgreSQL.
 *
 * Reglages, par variables d'environnement :
 *   DATABASE_URL           la base a sauvegarder (obligatoire)
 *   SAUVEGARDE_CLE         phrase secrete de chiffrement (obligatoire)
 *   SAUVEGARDE_DOSSIER     dossier local         (defaut ./sauvegardes)
 *   SAUVEGARDE_HORS_SITE   second dossier : NAS, disque externe, cloud
 *   SAUVEGARDE_RETENTION   jours conserves       (defaut 30)
 */
import { spawn } from 'node:child_process';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Charge le .env du serveur.
 *
 * Ces outils tournent en dehors de GestGlobale — par le planificateur
 * de taches de Windows, en pleine nuit — et n'heritent donc pas des
 * reglages du service. Ils lisent le meme fichier que lui, pour qu'il
 * n'y ait jamais deux verites sur l'adresse de la base.
 */
function chargerReglages() {
  const ici = dirname(fileURLToPath(import.meta.url));
  for (const candidat of [join(ici, '..', '.env'), join(process.cwd(), '.env')]) {
    if (existsSync(candidat)) {
      try {
        process.loadEnvFile(candidat);
      } catch {
        // Deja charge, ou Node trop ancien : on continue avec
        // l'environnement tel qu'il est.
      }
      return;
    }
  }
}
chargerReglages();


/** En-tete du fichier : de quoi se relire dans dix ans. */
export const MAGIE = Buffer.from('GESTGLOBALE-SAUV');
export const VERSION = 1;
const TAILLE_SEL = 32;
const TAILLE_IV = 12;
const TAILLE_MARQUE = 16;

/**
 * Derive la clef depuis la phrase secrete.
 *
 * Un sel par sauvegarde : deux sauvegardes faites avec la meme phrase
 * ne partagent pas leur clef, et une clef retrouvee n'ouvre qu'un seul
 * fichier.
 */
export function deriverClef(phrase, sel) {
  return scryptSync(phrase, sel, 32, { N: 16384, r: 8, p: 1 });
}

export function nomDeSauvegarde(maintenant = new Date()) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `gestglobale-${maintenant.getFullYear()}${p(maintenant.getMonth() + 1)}`
    + `${p(maintenant.getDate())}-${p(maintenant.getHours())}${p(maintenant.getMinutes())}`
    + '.sauv';
}

/**
 * Adresse de la base telle que pg_dump l'attend.
 *
 * Prisma ajoute « ?schema=public » a son URL ; pg_dump, lui, refuse ce
 * parametre et s'arrete. Sans ce nettoyage, la sauvegarde se terminait
 * « avec succes » sur un fichier vide — le pire des defauts, celui
 * qu'on decouvre le jour ou l'on en a besoin.
 */
export function urlPourPgDump(url) {
  const adresse = new URL(url);
  for (const parametre of [...adresse.searchParams.keys()]) {
    // On ne garde que ce que libpq comprend.
    if (!['sslmode', 'connect_timeout', 'application_name'].includes(parametre)) {
      adresse.searchParams.delete(parametre);
    }
  }
  return adresse.toString();
}

/** Lance pg_dump au format natif de PostgreSQL, deja compresse. */
function lancerPgDump(url) {
  const processus = spawn(
    'pg_dump',
    ['--format=custom', '--no-owner', '--no-privileges', urlPourPgDump(url)],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const erreurs = [];
  processus.stderr.on('data', (m) => erreurs.push(m.toString()));

  // La sortie de pg_dump et son code de retour sont deux choses
  // differentes : le flux peut se terminer proprement alors que le
  // processus a echoue. On rend donc les deux a l'appelant.
  const termine = new Promise((resoudre, rejeter) => {
    processus.on('error', (erreur) => rejeter(
      new Error(`pg_dump est introuvable ou n\u2019a pas demarre : ${erreur.message}`),
    ));
    processus.on('close', (code) => {
      if (code === 0) resoudre();
      else rejeter(new Error(`pg_dump a echoue (code ${code}) : ${erreurs.join('').trim()}`));
    });
  });

  return { flux: processus.stdout, termine };
}

/**
 * Taille en dessous de laquelle une sauvegarde n'est pas credible.
 *
 * L'enveloppe chiffree pese 77 octets a vide. Une base GestGlobale,
 * meme neuve, en fait des dizaines de milliers : en dessous de ce
 * seuil, quelque chose s'est mal passe et il vaut mieux crier.
 */
export const TAILLE_MINIMALE = 10 * 1024;

/**
 * Chiffre un flux vers un fichier.
 *
 * La marque d'authenticite est ecrite a la fin, une fois le flux
 * epuise : c'est la seule facon de chiffrer sans tout garder en
 * memoire, et une base de plusieurs gigaoctets ne tiendrait pas.
 */
async function chiffrerVers(flux, chemin, phrase) {
  const sel = randomBytes(TAILLE_SEL);
  const iv = randomBytes(TAILLE_IV);
  const clef = deriverClef(phrase, sel);
  const chiffreur = createCipheriv('aes-256-gcm', clef, iv);

  const sortie = createWriteStream(chemin);
  const entete = Buffer.concat([MAGIE, Buffer.from([VERSION]), sel, iv]);
  sortie.write(entete);

  await pipeline(flux, chiffreur, sortie, { end: false });

  await new Promise((resoudre, rejeter) => {
    sortie.end(chiffreur.getAuthTag(), (erreur) => (erreur ? rejeter(erreur) : resoudre()));
  });
}

/** Efface les sauvegardes passees la retention. */
async function faireLeMenage(dossier, jours) {
  const limite = Date.now() - jours * 86400000;
  const fichiers = await readdir(dossier).catch(() => []);
  const effaces = [];
  for (const fichier of fichiers) {
    if (!fichier.endsWith('.sauv')) continue;
    const chemin = join(dossier, fichier);
    const info = await stat(chemin);
    if (info.mtimeMs < limite) {
      await unlink(chemin);
      effaces.push(fichier);
    }
  }
  return effaces;
}

export async function sauvegarder(reglages = {}) {
  const url = reglages.url ?? process.env.DATABASE_URL;
  const phrase = reglages.phrase ?? process.env.SAUVEGARDE_CLE;
  const dossier = reglages.dossier ?? process.env.SAUVEGARDE_DOSSIER ?? './sauvegardes';
  const horsSite = reglages.horsSite ?? process.env.SAUVEGARDE_HORS_SITE ?? null;
  const retention = Number(reglages.retention ?? process.env.SAUVEGARDE_RETENTION ?? 30);

  if (!url) throw new Error('DATABASE_URL n’est pas renseignee');
  if (!phrase || phrase.length < 12) {
    throw new Error(
      'SAUVEGARDE_CLE doit faire au moins 12 caracteres. Sans elle, la copie '
      + 'hors site serait lisible par quiconque met la main dessus.',
    );
  }

  await mkdir(dossier, { recursive: true });
  const nom = nomDeSauvegarde();
  const chemin = join(dossier, nom);

  const debut = Date.now();
  const dump = lancerPgDump(url);
  try {
    await chiffrerVers(dump.flux, chemin, phrase);
    // On attend le code de retour, pas seulement la fin du flux.
    await dump.termine;
  } catch (erreur) {
    // Un fichier a moitie ecrit vaut pire que pas de fichier : il
    // ferait croire a une sauvegarde le jour ou l'on compte dessus.
    await unlink(chemin).catch(() => undefined);
    throw erreur;
  }

  const taille = (await stat(chemin)).size;
  if (taille < TAILLE_MINIMALE) {
    await unlink(chemin).catch(() => undefined);
    throw new Error(
      `La sauvegarde ne fait que ${taille} octets : elle est vide ou tronquee. `
      + 'Rien n\u2019a ete conserve. Verifiez que pg_dump atteint bien la base.',
    );
  }

  let copieHorsSite = null;
  if (horsSite) {
    // La copie hors site est tentee, pas exigee : un NAS debranche ne
    // doit pas faire perdre la sauvegarde locale, qui est deja ecrite.
    try {
      await mkdir(horsSite, { recursive: true });
      copieHorsSite = join(horsSite, nom);
      await copyFile(chemin, copieHorsSite);
    } catch (erreur) {
      copieHorsSite = null;
      console.error(
        `Copie hors site impossible (${erreur.message}). `
        + 'La sauvegarde locale, elle, est en place.',
      );
    }
  }

  const effaces = await faireLeMenage(dossier, retention);

  return {
    fichier: chemin,
    tailleOctets: taille,
    dureeMs: Date.now() - debut,
    copieHorsSite,
    effaces,
  };
}

// Execution directe en ligne de commande.
if (process.argv[1] && basename(process.argv[1]) === 'sauvegarde.mjs') {
  sauvegarder()
    .then((r) => {
      const mo = (r.tailleOctets / 1024 / 1024).toFixed(1);
      console.log(`Sauvegarde ecrite : ${r.fichier} (${mo} Mo en ${(r.dureeMs / 1000).toFixed(1)} s)`);
      if (r.copieHorsSite) console.log(`Copie hors site   : ${r.copieHorsSite}`);
      if (r.effaces.length > 0) {
        console.log(`Retention         : ${r.effaces.length} sauvegarde(s) effacee(s)`);
      }
    })
    .catch((erreur) => {
      console.error(`Sauvegarde impossible : ${erreur.message}`);
      process.exit(1);
    });
}
