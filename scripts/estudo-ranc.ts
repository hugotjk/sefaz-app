/**
 * SOMENTE LEITURA: estuda a RANC. Lista (1) os produtos da RANC no catálogo (referência | modelo | nome)
 * e (2) os itens das notas (código | descrição) para descobrir como a referência é montada.
 *   npx tsx --env-file=.env scripts/estudo-ranc.ts
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const prods = await prisma.produto.findMany({
    where: { fornecedorNome: { contains: "RANC", mode: "insensitive" } },
    select: { referenciaFornecedor: true, modeloNome: true, nome: true, fornecedorNome: true },
    orderBy: { referenciaFornecedor: "asc" },
  });
  console.log(`== Catálogo: ${prods.length} produtos de fornecedor RANC ==`);
  const mods = new Map<string, number>();
  for (const p of prods) mods.set(`${p.modeloNome}`, (mods.get(`${p.modeloNome}`) ?? 0) + 1);
  console.log("Modelos:", [...mods.entries()].map(([k, v]) => `${k}=${v}`).join(" ; "));
  console.log("(referência | modelo | nome)");
  for (const p of prods.slice(0, 120)) console.log(`  ${p.referenciaFornecedor} | ${p.modeloNome} | ${p.nome}`);

  const itens = await prisma.$queryRaw<{ cod: string; descricao: string }[]>`
    SELECT DISTINCT ni."codigoProduto" AS cod, ni.descricao
    FROM "NotaItem" ni JOIN "Note" n ON n.id = ni."noteId"
    WHERE n."emitenteNome" ILIKE 'RANC CONFECCOES%'
    ORDER BY 1`;
  console.log(`\n== Notas: ${itens.length} itens distintos (código | descrição) ==`);
  for (const i of itens.slice(0, 120)) console.log(`  ${i.cod} | ${i.descricao}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
