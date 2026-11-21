/**
 * Import definitif d'un export, contre une base reelle.
 *
 *   npx ts-node -T scripts/importer-export.ts chemin/VENTES_2026.xlsx [--forcer]
 *
 * A n'employer que sur une base preparee par le seed de demonstration,
 * qui fournit la societe, le magasin, les emplacements et les comptes.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { ImportService } from '../src/import/import.service';

const da = (n: number) => (n / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 });

async function main(): Promise<void> {
  const chemin = process.argv[2];
  const forcer = process.argv.includes('--forcer');
  if (!chemin) {
    console.error('Usage : ts-node scripts/importer-export.ts <fichier.xlsx> [--forcer]');
    process.exit(1);
  }

  const prisma = new PrismaService();
  await prisma.$connect();
  const audit = new AuditService(prisma);
  const service = new ImportService(prisma, audit);

  const magasin = await prisma.magasin.findFirstOrThrow({ where: { code: 'SV' } });
  const depot = await prisma.emplacement.findFirstOrThrow({
    where: { magasinId: magasin.id, code: 'MC' },
  });
  const vente = await prisma.emplacement.findFirstOrThrow({
    where: { magasinId: magasin.id, code: 'SV' },
  });
  const gerant = await prisma.utilisateur.findFirstOrThrow({ where: { login: 'gerant' } });

  // On part d'un catalogue vide : l'import de bascule remplace, il ne
  // complete pas. Le jeu de demonstration est donc retire.
  console.log('Nettoyage du catalogue de demonstration...');
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "LigneVente", "Reglement", "DocumentVente", "MouvementStock",
      "LigneInventaire", "Inventaire", "Lot", "Stock", "HistoriquePrix",
      "PrixArticle", "CodeVrac", "CodeBarre", "LigneReception", "Reception",
      "LigneCommande", "CommandeFournisseur", "FactureAchat", "Echeance",
      "MouvementTiers", "OperationTresorerie", "Article", "Tiers", "Famille", "Rayon"
    RESTART IDENTITY CASCADE`);
  await prisma.compteTresorerie.updateMany({ data: { soldeCentimes: BigInt(0) } });

  console.log(`Import de ${chemin}${forcer ? ' (en forcant)' : ''}...\n`);
  const debut = Date.now();
  const resultat = await service.executer({
    tampon: readFileSync(chemin),
    nomFichier: chemin.split('/').pop() ?? 'export.xlsx',
    magasinId: magasin.id,
    emplacementDepotId: depot.id,
    emplacementVenteId: vente.id,
    utilisateurId: gerant.id,
    forcer,
  });

  if (!resultat.importe) {
    console.log(`IMPORT REFUSE : ${resultat.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`Historique repris : ${(resultat.lignesHistorique ?? 0).toLocaleString('fr-FR')} ligne(s)`);
  console.log(`Import termine en ${resultat.dureeSecondes} s ` +
    `(${((Date.now() - debut) / 1000).toFixed(0)} s avec l'analyse)\n`);
  console.log('Ecrit en base');
  console.log('-------------');
  for (const [cle, valeur] of Object.entries(resultat.compteurs)) {
    console.log(`  ${cle.padEnd(16)} ${String(valeur).padStart(8)}`);
  }

  const controles = await service.controlesDeBascule();
  console.log('\nControles de bascule, relus depuis la base');
  console.log('------------------------------------------');
  console.log(`  Articles ....................... ${controles.nombreArticles.toLocaleString('fr-FR')}`);
  console.log(`  Codes-barres ................... ${controles.nombreCodesBarres.toLocaleString('fr-FR')}`);
  console.log(`  Packs .......................... ${controles.nombrePacks.toLocaleString('fr-FR')}`);
  console.log(`  Vracs .......................... ${controles.nombreVracs.toLocaleString('fr-FR')}`);
  console.log(`  Clients ........................ ${controles.nombreClients.toLocaleString('fr-FR')}`);
  console.log(`  Fournisseurs ................... ${controles.nombreFournisseurs.toLocaleString('fr-FR')}`);
  console.log(`  Valeur du stock au CUMP ........ ${da(controles.valeurStockCumpCentimes)} DA`);
  console.log(`  Total soldes clients ........... ${da(controles.totalSoldesClientsCentimes)} DA`);
  console.log(`  Total soldes fournisseurs ...... ${da(controles.totalSoldesFournisseursCentimes)} DA`);

  const attendu = resultat.controles;
  console.log('\nComparaison fichier / base');
  console.log('--------------------------');
  const comparer = (libelle: string, fichier: number, base: number) => {
    const ecart = base - fichier;
    const marque = ecart === 0 ? 'identique' : `ecart ${ecart > 0 ? '+' : ''}${ecart}`;
    console.log(`  ${libelle.padEnd(26)} fichier ${String(fichier).padStart(12)}   base ${String(base).padStart(12)}   ${marque}`);
  };
  comparer('Articles', attendu.nombreArticles, controles.nombreArticles - controles.nombrePacks);
  comparer('Codes-barres', attendu.nombreCodesBarres, controles.nombreCodesBarres);
  comparer('Packs', attendu.nombrePacks, controles.nombrePacks);
  comparer('Vracs', attendu.nombreVracs, controles.nombreVracs);
  comparer('Clients', attendu.nombreClients, controles.nombreClients);
  comparer('Fournisseurs', attendu.nombreFournisseurs, controles.nombreFournisseurs);
  comparer('Valeur du stock (centimes)', attendu.valeurStockCumpCentimes, controles.valeurStockCumpCentimes);
  comparer('Soldes clients (centimes)', attendu.totalSoldesClientsCentimes, controles.totalSoldesClientsCentimes);
  comparer('Soldes fournisseurs (cent.)', attendu.totalSoldesFournisseursCentimes, controles.totalSoldesFournisseursCentimes);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); process.exit(1); });
