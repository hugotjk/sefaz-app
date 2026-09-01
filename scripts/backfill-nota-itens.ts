/**
 * Popula NotaItem para as notas que JÁ têm xmlCompleto salvo mas ainda não
 * têm itens (sincronizadas antes da Fase A).
 *
 *   npx tsx --env-file=.env scripts/backfill-nota-itens.ts
 */
import { prisma } from "../src/lib/db";
import { popularNotaItens } from "../src/lib/popular-nota-itens";

const LOTE = 50;

async function main() {
  let feitas = 0;
  let itensTotal = 0;
  let semItens = 0;
  const jaVistas = new Set<string>();

  for (let volta = 0; volta < 100000; volta++) {
    const notas = await prisma.note.findMany({
      where: {
        xmlCompleto: { not: "" },
        itens: { none: {} },
        id: { notIn: [...jaVistas] },
      },
      select: { id: true, xmlCompleto: true },
      take: LOTE,
    });
    if (notas.length === 0) break;

    for (const n of notas) {
      jaVistas.add(n.id);
      if (n.xmlCompleto.length < 2000) {
        semItens++;
        continue; // resumo travado, não é procNFe
      }
      const q = await popularNotaItens(n.id, n.xmlCompleto);
      itensTotal += q.itens;
      feitas++;
      if (q.itens === 0) semItens++;
    }
    console.log(`... ${feitas} notas com itens | ${itensTotal} NotaItem | ${semItens} sem itens úteis`);
  }

  console.log(`\nOK. ${feitas} notas processadas, ${itensTotal} NotaItem gravados, ${semItens} sem itens.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
