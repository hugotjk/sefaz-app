/**
 * Importa lojas-referencia.tsv (raiz do projeto) na tabela LojaReferencia.
 *
 *   npx tsx --env-file=.env scripts/importar-lojas-referencia.ts
 */
import { readFileSync } from "fs";
import { prisma } from "../src/lib/db";
import { importarLojasReferenciaTsv } from "../src/lib/importar-lojas-referencia";

async function main() {
  const tsv = readFileSync("lojas-referencia.tsv", "utf8");
  const r = await importarLojasReferenciaTsv(tsv);
  console.log(
    `Linhas no arquivo: ${r.linhas} | importadas/upsertadas: ${r.importadas} | ignoradas: ${r.ignoradas}`
  );
  if (r.erros.length) {
    console.log(`\n${r.erros.length} avisos:`);
    r.erros.slice(0, 30).forEach((e) => console.log("  " + e));
  }
  const total = await prisma.lojaReferencia.count();
  const ativos = await prisma.lojaReferencia.count({ where: { status: "ATIVO" } });
  console.log(`\nLojaReferencia agora: ${total} linhas (${ativos} ATIVO, ${total - ativos} INATIVO/outro)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
