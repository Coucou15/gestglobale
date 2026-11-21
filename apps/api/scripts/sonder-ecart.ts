/** Explique un ecart entre ce que l'analyse retient et ce que la base contient. */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { ImportService } from '../src/import/import.service';

const service = new ImportService(null as never, null as never);

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  // On rejoue la preparation pour disposer de la liste exacte.
  const prive = service as unknown as {
    preparer(t: Buffer): Promise<{ donnees: { codesBarres: Array<{ code: string; reference: string }> } }>;
  };
  const { donnees } = await prive.preparer(readFileSync(process.argv[2]));
  console.log(`codes generiques retenus par l'analyse : ${donnees.codesBarres.length}`);

  const references = [...new Set(donnees.codesBarres.map((c) => c.reference))];
  const existants = await prisma.article.findMany({
    where: { reference: { in: references } },
    select: { reference: true },
  });
  const presentes = new Set(existants.map((a) => a.reference));
  const absentes = references.filter((r) => !presentes.has(r));
  console.log(`references citees : ${references.length}, absentes de la base : ${absentes.length}`);
  if (absentes.length > 0) {
    console.log(`  exemples : ${absentes.slice(0, 6).join(', ')}`);
    const perdus = donnees.codesBarres.filter((c) => !presentes.has(c.reference));
    console.log(`  codes perdus a cause de ces references : ${perdus.length}`);
  }

  const enBase = await prisma.codeBarre.count({ where: { principal: false } });
  console.log(`codes non principaux en base : ${enBase}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
