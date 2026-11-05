/**
 * Diagnóstico SOMENTE LEITURA: dá para buscar o preço de UMA variação (ou produto)
 * direto na API do PDV, sem varrer a tabela inteira (~750 mil linhas)?
 * Também mostra o andamento da sync diária de preços.
 *
 * Uso: npx tsx --env-file=.env scripts\diagnostico-preco-por-variacao.ts [REFERENCIA_FORNECEDOR]
 */
import { PrismaClient } from "@prisma/client";
import { consultarPrecosComParametros } from "../src/lib/pdvapi";

const prisma = new PrismaClient();
const TABELA = 3; // "3 VAREJO"

async function main() {
  const ref = process.argv[2] ?? "";
  const cur = await prisma.syncState.findUnique({ where: { chave: "precos:cursor" } });
  console.log("Cursor da sync de preços:", cur ? `${cur.valor} (atualizado ${cur.updatedAt.toISOString()})` : "(nenhum)");
  const [c] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "PrecoVariacao"`);
  const [v] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM "VariacaoProduto"`);
  console.log(`PrecoVariacao: ${c.n} linhas | VariacaoProduto: ${v.n} linhas`);

  const alvo = await prisma.$queryRawUnsafe<{ id: string; produtoId: string; ref: string | null }[]>(
    ref
      ? `SELECT v.id, v."produtoId", p."referenciaFornecedor" AS ref FROM "VariacaoProduto" v JOIN "Produto" p ON p.id = v."produtoId" WHERE UPPER(BTRIM(p."referenciaFornecedor")) = '${ref.toUpperCase().replace(/'/g, "")}' LIMIT 1`
      : `SELECT v.id, v."produtoId", p."referenciaFornecedor" AS ref FROM "VariacaoProduto" v JOIN "Produto" p ON p.id = v."produtoId" ORDER BY p."updatedAt" DESC LIMIT 1`
  );
  if (!alvo.length) return console.log("Nenhuma variação encontrada.");
  const { id, produtoId } = alvo[0];
  console.log(`\nVariação de teste: ${id} (produto ${produtoId}, ref ${alvo[0].ref})`);

  const testes: Record<string, string | number>[] = [
    { VariacaoId: id },
    { variacaoId: id },
    { IdVariacao: id },
    { ProdutoId: produtoId },
    { produtoId },
    { Referencia: alvo[0].ref ?? "" },
    { DataAtualizacao: new Date(Date.now() - 86400000).toISOString().slice(0, 10) },
    { DataAtualizacaoInicial: new Date(Date.now() - 86400000).toISOString().slice(0, 10) },
  ];
  for (const t of testes) {
    try {
      const r = await consultarPrecosComParametros(TABELA, t);
      const ids = r.registros.map((x) => x.VariacaoId);
      const filtrou = ids.length > 0 && ids.every((x) => x === id) ? "FILTROU ✔" : "ignorou o filtro";
      console.log(`${JSON.stringify(t).slice(0, 70).padEnd(72)} -> ${ids.length} registros | ${filtrou}`);
    } catch (e: any) {
      console.log(`${JSON.stringify(t).slice(0, 70).padEnd(72)} -> erro: ${String(e.message).slice(0, 80)}`);
    }
  }
}
main().finally(() => prisma.$disconnect());
