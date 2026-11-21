/**
 * Analyse hors ligne d'un export de l'ancien logiciel.
 *
 * Rend le meme rapport que l'import a blanc de l'assistant, sans serveur
 * ni base : pratique pour eprouver un fichier client avant la bascule.
 *
 *   npx ts-node -T scripts/analyser-export.ts chemin/VENTES_2026.xlsx
 */
import { readFileSync } from 'node:fs';
import { ImportService } from '../src/import/import.service';

const service = new ImportService(null as never, null as never);
const da = (n: number) => (n / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 });

async function main(): Promise<void> {
  const chemin = process.argv[2];
  if (!chemin) {
    console.error('Usage : ts-node scripts/analyser-export.ts <fichier.xlsx>');
    process.exit(1);
  }

  const debut = Date.now();
  const { resultat } = await service.analyser(readFileSync(chemin));
  console.log(`Analyse en ${((Date.now() - debut) / 1000).toFixed(1)} s\n`);

  console.log('Onglets lus');
  console.log('-----------');
  for (const [nom, r] of Object.entries(resultat.onglets)) {
    console.log(
      `  ${nom.padEnd(22)} lus ${String(r.lus).padStart(6)}` +
      `   retenus ${String(r.retenus).padStart(6)}` +
      `   ignores ${String(r.ignores).padStart(3)}` +
      `   erreurs ${String(r.erreurs).padStart(6)}`,
    );
  }

  const c = resultat.controles;
  console.log('\nControles de bascule');
  console.log('--------------------');
  console.log(`  Articles ....................... ${c.nombreArticles.toLocaleString('fr-FR')}`);
  console.log(`  Codes-barres ................... ${c.nombreCodesBarres.toLocaleString('fr-FR')}`);
  console.log(`  Packs .......................... ${c.nombrePacks.toLocaleString('fr-FR')}`);
  console.log(`  Vracs .......................... ${c.nombreVracs.toLocaleString('fr-FR')}`);
  console.log(`  Valeur du stock au CUMP ........ ${da(c.valeurStockCumpCentimes)} DA`);
  console.log(`  Total soldes clients ........... ${da(c.totalSoldesClientsCentimes)} DA`);
  console.log(`  Total soldes fournisseurs ...... ${da(c.totalSoldesFournisseursCentimes)} DA`);
  console.log(`  Articles a stock nul ........... ${c.articlesStockNul.toLocaleString('fr-FR')}`);
  console.log(`  Articles a stock negatif ....... ${c.articlesStockNegatif.toLocaleString('fr-FR')}`);

  const parCode = new Map<string, { n: number; gravite: string; exemple: string }>();
  for (const a of resultat.anomalies) {
    const cle = `${a.onglet} / ${a.code}`;
    const v = parCode.get(cle) ?? { n: 0, gravite: a.gravite, exemple: a.message };
    v.n++;
    parCode.set(cle, v);
  }

  console.log(`\nAnomalies : ${resultat.anomalies.length.toLocaleString('fr-FR')}`);
  console.log('---------');
  for (const [cle, v] of [...parCode.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(v.n).padStart(6)}  ${v.gravite.padEnd(13)} ${cle}`);
    console.log(`          ${v.exemple.slice(0, 115)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
