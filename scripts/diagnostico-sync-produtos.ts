/**
 * Diagnóstico SOMENTE LEITURA: por que um produto cadastrado ontem aparece "sem cadastro"?
 * Uso: npx tsx --env-file=.env scripts\diagnostico-sync-produtos.ts [REFERENCIA] [MODELO]
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const [refArg, modeloArg] = process.argv.slice(2);

  console.log("=== 1. Cursor do syncProdutos ===");
  const estados = await prisma.syncState.findMany({
    where: { chave: { startsWith: "produtos:" } },
    orderBy: { chave: "asc" },
  });
  for (const e of estados) console.log(`${e.chave}  atualizado=${e.updatedAt.toISOString()}  valor=${e.valor}`);
  if (estados.length === 0) console.log("(nenhum cursor)");

  console.log("\n=== 2. Produtos gravados/atualizados por dia (últimos 10 dias) ===");
  const porDia = await prisma.$queryRawUnsafe<{ dia: string; n: bigint }[]>(
    `SELECT to_char("updatedAt" AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS dia, count(*) AS n
       FROM "Produto" WHERE "updatedAt" > now() - interval '10 days' GROUP BY 1 ORDER BY 1 DESC`
  );
  for (const r of porDia) console.log(`${r.dia}  ${r.n}`);

  console.log("\n=== 3. Variações sem EAN (ainda não enriquecidas) ===");
  const [sem] = await prisma.$queryRawUnsafe<{ total: bigint; semean: bigint }[]>(
    `SELECT count(*) AS total, count(*) FILTER (WHERE ean IS NULL) AS semean FROM "VariacaoProduto"`
  );
  console.log(`total=${sem.total} sem EAN=${sem.semean}`);

  if (refArg) {
    console.log(`\n=== 4. Produto ref="${refArg}"${modeloArg ? ` modelo="${modeloArg}"` : ""} ===`);
    const prods = await prisma.$queryRawUnsafe<any[]>(
      `SELECT p.id, p."referenciaFornecedor" AS ref, p."modeloNome" AS modelo, p.nome, p."updatedAt",
              count(v.id) AS variacoes, count(v.ean) AS com_ean
         FROM "Produto" p LEFT JOIN "VariacaoProduto" v ON v."produtoId" = p.id
        WHERE upper(trim(p."referenciaFornecedor")) = upper(trim($1))
          AND ($2::text IS NULL OR upper(trim(p."modeloNome")) = upper(trim($2)))
        GROUP BY p.id`,
      refArg,
      modeloArg ?? null
    );
    if (prods.length === 0) console.log("NÃO existe em Produto (o sync ainda não trouxe).");
    for (const p of prods)
      console.log(`${p.id} | ref=${p.ref} | modelo=${p.modelo} | ${p.nome} | atualizado=${p.updatedAt.toISOString()} | variações=${p.variacoes} (com EAN: ${p.com_ean})`);
  }
}
main().finally(() => prisma.$disconnect());
