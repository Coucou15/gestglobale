#!/usr/bin/env node
/**
 * Restauration d'une sauvegarde chiffree.
 *
 *   node apps/api/outils/restaurer.mjs <fichier.sauv> [url-de-la-base]
 *
 * La base visee est **ecrasee**. Sans second argument, c'est celle de
 * DATABASE_URL : on vise donc une base de test avant de viser la vraie.
 *
 * Le serveur GestGlobale doit etre arrete pendant l'operation : une
 * restauration qui remplace les tables sous un serveur en marche le
 * laisse avec des plans de requete perimes.
 */
import { spawn } from 'node:child_process';
import { createDecipheriv, scryptSync } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
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


const MAGIE = Buffer.from('GESTGLOBALE-SAUV');
const TAILLE_SEL = 32;
const TAILLE_IV = 12;
const TAILLE_MARQUE = 16;
const TAILLE_ENTETE = MAGIE.length + 1 + TAILLE_SEL + TAILLE_IV;

/** Lit l'en-tete et la marque d'authenticite sans charger le fichier. */
async function lireEnveloppe(chemin) {
  const taille = (await stat(chemin)).size;
  if (taille < TAILLE_ENTETE + TAILLE_MARQUE) {
    throw new Error('Fichier trop court pour etre une sauvegarde GestGlobale');
  }

  const fichier = await open(chemin, 'r');
  try {
    const entete = Buffer.alloc(TAILLE_ENTETE);
    await fichier.read(entete, 0, TAILLE_ENTETE, 0);
    if (!entete.subarray(0, MAGIE.length).equals(MAGIE)) {
      throw new Error(
        'Ce fichier n’est pas une sauvegarde GestGlobale : sa signature ne correspond pas',
      );
    }
    const version = entete[MAGIE.length];
    if (version !== 1) {
      throw new Error(`Sauvegarde en version ${version}, inconnue de cet outil`);
    }

    const marque = Buffer.alloc(TAILLE_MARQUE);
    await fichier.read(marque, 0, TAILLE_MARQUE, taille - TAILLE_MARQUE);

    return {
      sel: entete.subarray(MAGIE.length + 1, MAGIE.length + 1 + TAILLE_SEL),
      iv: entete.subarray(MAGIE.length + 1 + TAILLE_SEL),
      marque,
      debutDonnees: TAILLE_ENTETE,
      finDonnees: taille - TAILLE_MARQUE - 1,
    };
  } finally {
    await fichier.close();
  }
}

export async function restaurer(chemin, urlCible, phrase) {
  const url = urlCible ?? process.env.DATABASE_URL;
  const secret = phrase ?? process.env.SAUVEGARDE_CLE;
  if (!url) throw new Error('Aucune base visee : donnez une URL ou renseignez DATABASE_URL');
  if (!secret) throw new Error('SAUVEGARDE_CLE n’est pas renseignee');

  // pg_restore refuse lui aussi le « ?schema=public » de Prisma.
  const adresse = new URL(url);
  for (const parametre of [...adresse.searchParams.keys()]) {
    if (!['sslmode', 'connect_timeout', 'application_name'].includes(parametre)) {
      adresse.searchParams.delete(parametre);
    }
  }

  const enveloppe = await lireEnveloppe(chemin);
  const clef = scryptSync(secret, enveloppe.sel, 32, { N: 16384, r: 8, p: 1 });
  const dechiffreur = createDecipheriv('aes-256-gcm', clef, enveloppe.iv);
  // La marque verifie a la fois la clef et l'integrite : un fichier
  // tronque ou retouche fait echouer la lecture plutot que de restaurer
  // une base a moitie juste.
  dechiffreur.setAuthTag(enveloppe.marque);

  const debut = Date.now();
  const restauration = spawn('pg_restore', [
    '--clean', '--if-exists', '--no-owner', '--no-privileges',
    '--dbname', adresse.toString(),
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  const erreurs = [];
  restauration.stderr.on('data', (m) => erreurs.push(m.toString()));
  const fini = new Promise((resoudre, rejeter) => {
    restauration.on('close', (code) => {
      // pg_restore rend 1 sur de simples avertissements (objets absents
      // a supprimer) ; seule une erreur franche doit arreter.
      const texte = erreurs.join('');
      if (code !== 0 && /ERROR/.test(texte) && !/does not exist/.test(texte)) {
        rejeter(new Error(`pg_restore a echoue : ${texte.trim().slice(0, 400)}`));
      } else {
        resoudre(texte);
      }
    });
  });

  await pipeline(
    createReadStream(chemin, {
      start: enveloppe.debutDonnees,
      end: enveloppe.finDonnees,
    }),
    dechiffreur,
    restauration.stdin,
  );

  const journal = await fini;
  return {
    dureeMs: Date.now() - debut,
    avertissements: journal.split('\n').filter((l) => l.trim()).length,
  };
}

if (process.argv[1] && basename(process.argv[1]) === 'restaurer.mjs') {
  const [, , fichier, url] = process.argv;
  if (!fichier) {
    console.error('Usage : node restaurer.mjs <fichier.sauv> [url-de-la-base]');
    process.exit(1);
  }
  restaurer(fichier, url)
    .then((r) => {
      console.log(`Restauration terminee en ${(r.dureeMs / 1000).toFixed(1)} s.`);
      console.log('Redemarrez le serveur GestGlobale avant de reprendre le travail.');
    })
    .catch((erreur) => {
      console.error(`Restauration impossible : ${erreur.message}`);
      process.exit(1);
    });
}
