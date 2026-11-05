/**
 * Diagnóstico SOMENTE LEITURA: de onde vêm os preços de uma referência de fornecedor?
 * Lista cada produto (rede), cada variação, o preço que o app guardou e o preço ATUAL
 * na API do PDV nas tabelas 3 (Varejo) e 7 (Varejo Off Rio).
 *
 * Uso: npx tsx --env-file=.env scripts\diagnostico-preco-referencia.ts 1300021306-1
 */
import { PrismaClient } from "@prisma/client";
import { listarPrecos } from "../src/lib/pdvapi";
import { precosPorVariacao } from "../src/lib/preco-por-variacao";

const prisma = new PrismaClient();

async function main() {
  const ref = (process.argv[2] ?? "").trim().toUpperCase();
  if (!ref) return console.log("Informe a referência do fornecedor. Ex.: 1300021306-1");

  const produtos = await prisma.$queryRaw<
    { id: string; redeId: number; nome: string | null; modeloNome: string | null; updatedAt: Date }[]
  >`SELECT id, "redeId", nome, "modeloNome", "updatedAt" FROM "Produto" WHERE UPPER(BTRIM("referenciaFornecedor")) = ${ref} ORDER BY "redeId", id`;
  console.log(`Produtos com a referência ${ref}: ${produtos.length}`);
  if (!produtos.length) return;

  const vars = await prisma.$queryRaw<
    { id: string; produtoId: string; cor: string | null; tamanho: string | null; ean: string | null; preco: number | null; precoEm: Date | null }[]
  >`SELECT v.id, v."produtoId", v.cor, v.tamanho, v.ean, pv.preco::float8 AS preco, pv."updatedAt" AS "precoEm"
    FROM "VariacaoProduto" v LEFT JOIN "PrecoVariacao" pv ON pv."variacaoId" = v.id
    WHERE v."produtoId" = ANY(${produtos.map((p) => p.id)}::text[]) ORDER BY v."produtoId", v.tamanho, v.id`;

  const ids = vars.map((v) => v.id);
  const primeira = await listarPrecos(3, { pagina: 1, tamanhoPagina: 50 });
  const total = primeira.paginacao?.TotalPaginas ?? 0;
  const t3 = await precosPorVariacao(3, ids, total);
  const t7 = await precosPorVariacao(7, ids, total);
  console.log(`(tabela 3: ${t3.chamadas} chamadas | tabela 7: ${t7.chamadas} chamadas; ${total} páginas na tabela 3)\n`);

  const f = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));
  for (const p of produtos) {
    console.log(`PRODUTO ${p.id} | rede ${p.redeId} | ${p.modeloNome ?? ""} | ${p.nome ?? ""}`);
    for (const v of vars.filter((x) => x.produtoId === p.id)) {
      console.log(
        `   var ${v.id} | tam ${String(v.tamanho ?? "").padEnd(4)} cor ${String(v.cor ?? "").padEnd(10)} | ` +
          `app: ${f(v.preco).padStart(8)} (${v.precoEm ? v.precoEm.toISOString().slice(0, 10) : "sem data"}) | ` +
          `API t3: ${f(t3.precos.get(v.id)).padStart(8)} | API t7: ${f(t7.precos.get(v.id)).padStart(8)}`
      );
    }
  }
}
main().finally(() => prisma.$disconnect());
