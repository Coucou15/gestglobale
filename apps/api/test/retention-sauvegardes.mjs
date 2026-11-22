/**
 * Retention des sauvegardes (critere : 30 jours).
 *
 *   node apps/api/test/retention-sauvegardes.mjs
 *
 * La retention doit effacer les vieilles sauvegardes et garder les
 * recentes. Un dossier qui ne se vide jamais finit par remplir le
 * disque du serveur, et c'est la sauvegarde suivante qui echoue.
 */
import { mkdtemp, writeFile, utimes, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dossier = await mkdtemp(join(tmpdir(), 'retention-'));
const jours = (n) => new Date(Date.now() - n * 86400000);

for (const [nom, age] of [
  ['gestglobale-ancienne.sauv', 40],
  ['gestglobale-limite.sauv', 31],
  ['gestglobale-recente.sauv', 5],
  ['gestglobale-hier.sauv', 1],
  ['notes.txt', 90],
]) {
  const chemin = join(dossier, nom);
  await writeFile(chemin, 'x'.repeat(20000));
  await utimes(chemin, jours(age), jours(age));
}

process.env.SAUVEGARDE_CLE = 'phrase-de-controle-retention';
process.env.SAUVEGARDE_DOSSIER = dossier;
process.env.SAUVEGARDE_RETENTION = '30';
delete process.env.SAUVEGARDE_HORS_SITE;

const { sauvegarder } = await import('../outils/sauvegarde.mjs');
const resultat = await sauvegarder();

const restants = (await readdir(dossier)).sort();
let ok = 0, total = 0;
const etape = (n, r, d = '') => { total++; if (r) ok++; console.log(`  ${r ? 'OK   ' : 'ECHEC'} ${n}${d ? ` — ${d}` : ''}`); };

etape('Les sauvegardes passees la retention sont effacees',
  !restants.includes('gestglobale-ancienne.sauv')
    && !restants.includes('gestglobale-limite.sauv'),
  resultat.effaces.join(', '));
etape('Les recentes sont gardees',
  restants.includes('gestglobale-recente.sauv') && restants.includes('gestglobale-hier.sauv'));
etape('Ce qui n’est pas une sauvegarde n’est pas touche',
  restants.includes('notes.txt'));
etape('La sauvegarde du jour est bien la',
  restants.some((f) => f.startsWith('gestglobale-20')));

console.log(`\nResultat : ${ok} / ${total}`);
process.exit(ok === total ? 0 : 1);
