/**
 * Diagnóstico SOMENTE LEITURA de um item de nota: como a referência/modelo foram
 * identificados e se casam com o Produto do PDV.
 * Uso: npx tsx --env-file=.env scripts\diagnostico-item-nota.ts HYBM01041802
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const termo = process.argv[2];
  if (!termo) throw new Error("Informe um trecho da referência/código.");
  const like = `%${termo}%`;

  console.log(`=== NotaItem com "${termo}" no código, descrição ou referência identificada ===`);
  const itens = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ni.id, regexp_replace(ni."codigoProduto",'[^[:print:]]',' ','g') AS codigo,
            left(regexp_replace(ni."descricao",'[^[:print:]]',' ','g'),70) AS descricao,
            ni.ean, ni."referenciaFornecedorIdentificada" AS ref_ident, ni."modeloIdentificado" AS modelo_ident,
            ni."temCadastro" AS tem, n."emitenteNome" AS emitente, n."dataEmissao" AS emissao
       FROM "NotaItem" ni JOIN "Note" n ON n.id = ni."noteId"
      WHERE ni."codigoProduto" ILIKE $1 OR ni."descricao" ILIKE $1 OR ni."referenciaFornecedorIdentificada" ILIKE $1
      ORDER BY n."dataEmissao" DESC NULLS LAST LIMIT 15`,
    like
  );
  if (itens.length === 0) console.log("(nenhum item encontrado)");
  for (const i of itens)
    console.log(`${i.tem ? "OK " : "SEM"} | cod=${i.codigo} | ref_ident=${i.ref_ident} | modelo_ident=${i.modelo_ident} | ean=${i.ean} | ${i.emitente} | ${String(i.emissao).slice(0, 10)}\n      ${i.descricao}`);

  console.log(`\n=== Produto no PDV com "${termo}" ===`);
  const prods = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, "referenciaFornecedor" AS ref, "modeloNome" AS modelo, nome, "fornecedorNome" AS fornecedor
       FROM "Produto" WHERE "referenciaFornecedor" ILIKE $1 LIMIT 10`,
    like
  );
  for (const p of prods) console.log(`${p.id} | ref=[${p.ref}] | modelo=[${p.modelo}] | ${p.fornecedor} | ${p.nome}`);
}
main().catch((e) => console.error(e.message)).finally(() => prisma.$disconnect());
