/**
 * Remove do banco os produtos/variações/preços/cursores de redes que o app não usa.
 * Padrão = SIMULAÇÃO (só conta). Para apagar: --apply
 * Uso: npx tsx --env-file=.env scripts\limpar-redes-inativas.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";
import { REDES_ATIVAS } from "../src/lib/redes-ativas";
const prisma = new PrismaClient();
async function main() {
  const apply = process.argv.includes("--apply");
  const ativas = REDES_ATIVAS;
  const cont = async (sql: string) => Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(sql, ativas))[0].n);
  const nProd = await cont(`SELECT count(*) n FROM "Produto" WHERE NOT ("redeId" = ANY($1::int[]))`);
  const nVar = await cont(`SELECT count(*) n FROM "VariacaoProduto" WHERE NOT ("redeId" = ANY($1::int[]))`);
  const nPreco = await cont(`SELECT count(*) n FROM "PrecoVariacao" pv WHERE EXISTS (SELECT 1 FROM "VariacaoProduto" v WHERE v.id = pv."variacaoId" AND NOT (v."redeId" = ANY($1::int[])))`);
  console.log(`Redes mantidas: ${ativas.join(", ")}`);
  console.log(`Fora delas: ${nProd} produtos, ${nVar} variações, ${nPreco} preços.`);
  if (!apply) return console.log("Simulação: nada apagado. Rode com --apply para apagar.");
  await prisma.$executeRawUnsafe(`DELETE FROM "PrecoVariacao" pv USING "VariacaoProduto" v WHERE v.id = pv."variacaoId" AND NOT (v."redeId" = ANY($1::int[]))`, ativas);
  await prisma.$executeRawUnsafe(`DELETE FROM "VariacaoProduto" WHERE NOT ("redeId" = ANY($1::int[]))`, ativas);
  await prisma.$executeRawUnsafe(`DELETE FROM "Produto" WHERE NOT ("redeId" = ANY($1::int[]))`, ativas);
  console.log("Apagado.");
}
main().catch((e) => console.error(e.message)).finally(() => prisma.$disconnect());
