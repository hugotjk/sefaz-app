/**
 * Diagnóstico SOMENTE LEITURA: variações ligadas ao produto errado?
 * 1) Mostra a variação de teste (a do mochila) e o produto a que o app a ligou.
 * 2) Conta variações cuja REDE é diferente da rede do produto (sinal de ligação errada).
 * 3) Conta variações cujo código não começa com o código do produto.
 * 4) Pergunta à API do PDV, em cada rede, quais variações o produto de mesmo código tem.
 *
 * Uso: npx tsx --env-file=.env scripts\diagnostico-variacoes-produto.ts [VARIACAO] [PRODUTO]
 *      (padrão: 64335490404314 64335)
 */
import { PrismaClient } from "@prisma/client";
import { listarVariacoesProduto } from "../src/lib/pdvapi";

const prisma = new PrismaClient();

async function main() {
  const varId = process.argv[2] ?? "64335490404314";
  const prodId = process.argv[3] ?? "64335";

  console.log("=== 1. A variação e o produto a que o app a ligou ===");
  const v = await prisma.$queryRawUnsafe<any[]>(
    `SELECT v.id, v."produtoId", v."redeId" AS var_rede, v.ean, v.cor, v.tamanho, v."updatedAt",
            p.nome, p."referenciaFornecedor" AS ref, p."redeId" AS prod_rede, p."modeloNome" AS modelo
     FROM "VariacaoProduto" v LEFT JOIN "Produto" p ON p.id = v."produtoId" WHERE v.id = '${varId.replace(/'/g, "")}'`
  );
  console.log(v.length ? v[0] : "(variação não encontrada)");

  console.log("\n=== 2. Redes e quantidade de produtos ===");
  const redes = await prisma.$queryRawUnsafe<{ id: number; nome: string; produtos: bigint }[]>(
    `SELECT r.id, r.nome, (SELECT COUNT(*) FROM "Produto" p WHERE p."redeId" = r.id) AS produtos FROM "RedeSync" r ORDER BY r.id`
  );
  for (const r of redes) console.log(`rede ${r.id} (${r.nome}): ${r.produtos} produtos`);

  console.log("\n=== 3. Variações com rede DIFERENTE da rede do produto ===");
  const [c1] = await prisma.$queryRawUnsafe<{ n: bigint; total: bigint }[]>(
    `SELECT COUNT(*) FILTER (WHERE v."redeId" <> p."redeId") AS n, COUNT(*) AS total
     FROM "VariacaoProduto" v JOIN "Produto" p ON p.id = v."produtoId"`
  );
  console.log(`${c1.n} de ${c1.total} variações`);
  const am1 = await prisma.$queryRawUnsafe<any[]>(
    `SELECT v.id AS variacao, v."redeId" AS rede_var, p.id AS produto, p."redeId" AS rede_prod, p."referenciaFornecedor" AS ref, p.nome
     FROM "VariacaoProduto" v JOIN "Produto" p ON p.id = v."produtoId" WHERE v."redeId" <> p."redeId" LIMIT 10`
  );
  console.table(am1);

  console.log("\n=== 4. Variações cujo código NÃO começa com o código do produto ===");
  const [c2] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM "VariacaoProduto" v WHERE LEFT(v.id, LENGTH(v."produtoId")) <> v."produtoId"`
  );
  console.log(`${c2.n} variações`);
  const am2 = await prisma.$queryRawUnsafe<any[]>(
    `SELECT v.id AS variacao, v."redeId" AS rede_var, v."produtoId" AS produto, p."redeId" AS rede_prod, p."referenciaFornecedor" AS ref, p.nome
     FROM "VariacaoProduto" v LEFT JOIN "Produto" p ON p.id = v."produtoId"
     WHERE LEFT(v.id, LENGTH(v."produtoId")) <> v."produtoId" LIMIT 10`
  );
  console.table(am2);

  console.log(`\n=== 5. API do PDV: variações do produto ${prodId} em cada rede ===`);
  for (const r of redes) {
    try {
      const vs = await listarVariacoesProduto(r.id, prodId);
      const tem = vs.some((x) => String(x.Id) === varId);
      console.log(`rede ${r.id} (${r.nome}): ${vs.length} variações | contém ${varId}: ${tem}`);
    } catch (e: any) {
      console.log(`rede ${r.id} (${r.nome}): ${String(e.message).slice(0, 70)}`);
    }
  }
}
main().finally(() => prisma.$disconnect());
