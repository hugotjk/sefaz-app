/**
 * SOMENTE LEITURA. Para uma referência de fornecedor (prefixo), mostra:
 *  - Produto no catálogo local (rede, modelo, referência, data de atualização no PDV)
 *  - NotaItem com essa referência (modelo/ref identificados, temCadastro)
 *  - cursor do sync de produtos por rede (SyncState) -> quando o app leu o PDV pela última vez
 *
 *   npx tsx --env-file=.env scripts/diag-ref-produto.ts --ref=26122701
 */
import { prisma } from "../src/lib/db";

const ref = (process.argv.find((a) => a.startsWith("--ref=")) ?? "").slice(6).trim().toUpperCase();

async function main() {
  if (!ref) return console.log("Use --ref=<referência do fornecedor>");
  const like = `${ref}%`;

  const prods = await prisma.$queryRaw<any[]>`
    SELECT id, "redeId", "referenciaFornecedor" AS ref, "modeloNome" AS modelo, "modeloId",
           "dataAtualizacaoPdv" AS atualizado, nome
      FROM "Produto"
     WHERE upper("referenciaFornecedor") LIKE ${like}
     ORDER BY "redeId", id`;
  console.log(`\n=== Produto no catálogo local (ref ~ ${ref}*): ${prods.length} ===`);
  prods.forEach((p) =>
    console.log(`  ${p.id} | rede ${p.redeId} | ref "${p.ref}" | modelo "${p.modelo}" (id ${p.modeloId}) | atualizado no PDV: ${p.atualizado?.toISOString?.() ?? p.atualizado} | ${String(p.nome).slice(0, 40)}`)
  );

  const itens = await prisma.$queryRaw<any[]>`
    SELECT i."codigoProduto", i."modeloIdentificado" AS modelo, i."referenciaFornecedorIdentificada" AS ref,
           i."temCadastro", i."updatedAt", n."emitenteNome" AS emit
      FROM "NotaItem" i JOIN "Note" n ON n.id = i."noteId"
     WHERE upper(i."referenciaFornecedorIdentificada") LIKE ${like}
     ORDER BY i."updatedAt" DESC
     LIMIT 20`;
  console.log(`\n=== NotaItem (ref identificada ~ ${ref}*): ${itens.length} (até 20) ===`);
  itens.forEach((i) =>
    console.log(`  cód "${i.codigoProduto}" | ref "${i.ref}" | modelo "${i.modelo}" | temCadastro=${i.temCadastro} | item atualizado em ${i.updatedAt.toISOString()} | ${i.emit}`)
  );

  const sync = await prisma.$queryRaw<any[]>`
    SELECT chave, valor, "updatedAt" FROM "SyncState" WHERE chave LIKE 'produtos:rede:%' ORDER BY chave`;
  console.log(`\n=== Cursor do sync de produtos ===`);
  sync.forEach((s) => console.log(`  ${s.chave}: ${s.valor} | gravado em ${s.updatedAt?.toISOString?.() ?? s.updatedAt}`));
  console.log(`\nAgora: ${new Date().toISOString()}`);
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
