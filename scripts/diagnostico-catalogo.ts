/**
 * Diagnóstico SOMENTE LEITURA: procura um produto no catálogo por nome, EAN ou
 * qualquer trecho (referência, nome) e mostra totais por rede.
 * Uso: npx tsx --env-file=.env scripts\diagnostico-catalogo.ts "ADISTAR CONTROL" 4068805993794
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const [termo, ean] = process.argv.slice(2);

  console.log("=== Produtos por rede (total / com referência) ===");
  const redes = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "redeId", count(*) AS n, count("referenciaFornecedor") AS com_ref, max("updatedAt") AS ultimo
       FROM "Produto" GROUP BY 1 ORDER BY 1`
  );
  for (const r of redes) console.log(`rede ${r.redeId}: ${r.n} produtos | ${r.com_ref} com referência | último gravado ${r.ultimo.toISOString()}`);

  if (termo) {
    console.log(`\n=== Produto com "${termo}" no nome ou referência ===`);
    const l = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "redeId", "referenciaFornecedor" AS ref, "modeloNome" AS modelo, nome
         FROM "Produto" WHERE nome ILIKE $1 OR "referenciaFornecedor" ILIKE $1 LIMIT 15`,
      `%${termo}%`
    );
    if (l.length === 0) console.log("(nenhum)");
    for (const p of l) console.log(`${p.id} | rede ${p.redeId} | ref=[${p.ref}] | modelo=[${p.modelo}] | ${p.nome}`);
  }

  if (ean) {
    console.log(`\n=== Variação com EAN ${ean} ===`);
    const v = await prisma.$queryRawUnsafe<any[]>(
      `SELECT v.id, v."produtoId", v.ean, v.tamanho, p."referenciaFornecedor" AS ref, p."modeloNome" AS modelo, p.nome
         FROM "VariacaoProduto" v LEFT JOIN "Produto" p ON p.id = v."produtoId" WHERE v.ean = $1`,
      ean
    );
    if (v.length === 0) console.log("(nenhuma variação com esse EAN)");
    for (const x of v) console.log(`${x.id} | produto ${x.produtoId} | tam=${x.tamanho} | ref=[${x.ref}] | modelo=[${x.modelo}] | ${x.nome}`);
  }
}
main().catch((e) => console.error(e.message)).finally(() => prisma.$disconnect());
