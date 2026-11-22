#!/usr/bin/env node
/**
 * Temoin de l'etat de la base, pour comparer avant et apres une
 * restauration.
 *
 * Les comptes seuls ne suffiraient pas : une base rebatie peut avoir le
 * bon nombre de lignes et des montants faux. On y ajoute donc les
 * totaux en centimes, et surtout la verification de la chaine
 * d'empreintes du journal d'audit — c'est elle qui prouve qu'aucune
 * ligne n'a ete perdue ni retouchee.
 */
import { PrismaClient } from '@prisma/client';
// L'empreinte vient du serveur lui-meme, pas d'une copie : une formule
// recopiee ici finirait par diverger de celle qui ecrit le journal, et
// le temoin accuserait une corruption qui n'existe pas. C'est
// exactement ce qui est arrive a la premiere version de cet outil.
import { empreinteDe } from '../dist/audit/audit.service.js';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
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


const prisma = new PrismaClient();

const n = (v) => (v === null || v === undefined ? 0 : Number(v));

try {
  const [
    articles, tickets, lignes, mouvements, tiers, bons, employes, bulletins, audit,
    ventes, stock, tresorerie,
  ] = await Promise.all([
    prisma.article.count(),
    prisma.documentVente.count(),
    prisma.ligneVente.count(),
    prisma.mouvementStock.count(),
    prisma.tiers.count(),
    prisma.bonAchat.count(),
    prisma.employe.count(),
    prisma.bulletinPaie.count(),
    prisma.journalAudit.count(),
    prisma.documentVente.aggregate({
      where: { statut: 'VALIDE' },
      _sum: { totalTtcCentimes: true, margeCentimes: true },
    }),
    prisma.stock.aggregate({ _sum: { quantiteMilli: true } }),
    prisma.compteTresorerie.aggregate({ _sum: { soldeCentimes: true } }),
  ]);

  // Verification de la chaine d'empreintes, entree par entree.
  const entrees = await prisma.journalAudit.findMany({ orderBy: { numero: 'asc' } });
  let attendue = null;
  let intacte = true;
  let premiereRompue = null;
  for (const entree of entrees) {
    const rompue = entree.empreintePrecedente !== attendue
      || empreinteDe(entree, entree.empreintePrecedente) !== entree.empreinte;
    if (rompue && intacte) {
      intacte = false;
      premiereRompue = entree.numero.toString();
    }
    attendue = entree.empreinte;
  }

  console.log([
    `articles=${articles}`,
    `tickets=${tickets}`,
    `lignes=${lignes}`,
    `mouvements=${mouvements}`,
    `tiers=${tiers}`,
    `bons=${bons}`,
    `employes=${employes}`,
    `bulletins=${bulletins}`,
    `audit=${audit}`,
    `ca=${n(ventes._sum.totalTtcCentimes)}`,
    `marge=${n(ventes._sum.margeCentimes)}`,
    `stock=${n(stock._sum.quantiteMilli)}`,
    `tresorerie=${n(tresorerie._sum.soldeCentimes)}`,
    `chaine_audit=${intacte ? 'intacte' : `rompue a ${premiereRompue}`}`,
  ].join('\n'));
} finally {
  await prisma.$disconnect();
}
