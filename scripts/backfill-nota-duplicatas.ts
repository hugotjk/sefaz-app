/**
 * Re-roda popularNotaItens (que agora também popula NotaDuplicata) sobre todas
 * as notas que já têm o XML completo salvo. Idempotente (delete + recreate).
 *
 *   npx tsx --env-file=.env scripts/backfill-nota-duplicatas.ts
 */
import { prisma } from "../src/lib/db";
import { popularNotaItens } from "../src/lib/popular-nota-itens";

async function main() {
  const notas = await prisma.note.findMany({
    where: { xmlCompleto: { not: "" } },
    select: { id: true, xmlCompleto: true },
  });
  console.log(`${notas.length} notas com xmlCompleto — processando…`);

  let feitas = 0;
  let itens = 0;
  let dups = 0;
  let comDuplicata = 0;

  for (const n of notas) {
    if (n.xmlCompleto.length < 2000) continue; // resumo travado
    const r = await popularNotaItens(n.id, n.xmlCompleto);
    itens += r.itens;
    dups += r.duplicatas;
    if (r.duplicatas > 0) comDuplicata++;
    feitas++;
  }

  console.log(
    `\nOK. ${feitas} notas | ${itens} NotaItem | ${dups} NotaDuplicata (${comDuplicata} notas com ao menos 1 duplicata).`
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
