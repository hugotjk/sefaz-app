/**
 * Diagnóstico (só leitura): por que a coluna EANs da planilha de Alteração de Cadastro ficou vazia/amarela
 * para uma referência. Mostra os produtos do PDV (rede MULTI), as variações locais (tamanho/EAN), os itens de
 * nota com EAN (e se o EAN falta no PDV) e o que o gerador diz que não conseguiu encaixar.
 *
 *   npx tsx --env-file=.env scripts/diag-alteracao-ref.ts --ref=FOF100631001 [--modelo=ADIDAS]
 */
import { PrismaClient } from "@prisma/client";
import { gerarAlteracaoCadastroXlsx } from "../src/lib/exportar-alteracao-cadastro";
import { tamanhoEDescricaoDoItem } from "../src/lib/exportar-cadastro-produtos";

const prisma = new PrismaClient();
const arg = (n: string) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3);

async function main() {
  const ref = (arg("ref") ?? "").trim().toUpperCase();
  if (!ref) throw new Error("use --ref=");
  const modeloArg = arg("modelo")?.trim().toUpperCase();

  const prods = await prisma.produto.findMany({
    where: { referenciaFornecedor: { equals: ref, mode: "insensitive" } },
    select: { id: true, redeId: true, nome: true, modeloNome: true, referenciaFornecedor: true },
    orderBy: { id: "asc" },
  });
  console.log(`\n== Produtos com referência ${ref} (todas as redes): ${prods.length}`);
  for (const p of prods) {
    const vs = await prisma.variacaoProduto.findMany({ where: { produtoId: p.id }, select: { tamanho: true, ean: true, cor: true } });
    const resumo = vs.map((v) => `${v.tamanho ?? "?"}:${v.ean === null ? "NULL" : v.ean === "" ? "(vazio)" : v.ean}`).join("  ");
    console.log(`- ${p.id} rede ${p.redeId} | modelo=${p.modeloNome} | ${p.nome}\n    variações(${vs.length}): ${resumo}`);
  }

  const itens = await prisma.$queryRaw<any[]>`
    SELECT i."modeloIdentificado" AS modelo, i."referenciaFornecedorIdentificada" AS ref, i.ean, i.descricao,
           i."codigoProduto" AS codigo, i."infAdProd" AS inf, n."emitenteNome" AS emitente, n."dataEmissao" AS data,
           NOT EXISTS (SELECT 1 FROM "VariacaoProduto" v WHERE v.ean = i.ean) AS falta
      FROM "NotaItem" i JOIN "Note" n ON n.id = i."noteId"
     WHERE upper(trim(i."referenciaFornecedorIdentificada")) = ${ref} AND i.ean ~ '^[0-9]{8,14}$'
     ORDER BY n."dataEmissao" DESC NULLS LAST LIMIT 80`;
  console.log(`\n== Itens de nota com EAN para ${ref}: ${itens.length}`);
  for (const it of itens) {
    const t = tamanhoEDescricaoDoItem({ emitente: it.emitente, modelo: it.modelo, codigo: it.codigo, descricao: it.descricao, ean: it.ean, infAdProd: it.inf, referencia: it.ref });
    console.log(`- ${it.ean} falta_no_PDV=${it.falta} tam=${t.tam ?? "(não identificado)"} | ${String(it.descricao).slice(0, 60)} | ${it.emitente}`);
  }

  const modelos = [...new Set(itens.map((i) => String(i.modelo ?? "").toUpperCase()).filter(Boolean))];
  for (const m of modeloArg ? [modeloArg] : modelos) {
    const { resumo } = await gerarAlteracaoCadastroXlsx([JSON.stringify([m, ref])]);
    console.log(`\n== Gerador (${m} ${ref}): linhas=${resumo.linhas} eansPreenchidos=${resumo.eansPreenchidos} tamanhosNovos=${resumo.tamanhosNovos}`);
    console.log("   semProdutoPdv:", resumo.semProdutoPdv);
    console.log("   eansSemPosicao:", resumo.eansSemPosicao);
  }
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
