/**
 * SOMENTE LEITURA: por que itens da Xeryus seguem "sem cadastro" se o produto existe no PDV?
 * Mostra o que o NOSSO banco tem hoje para esses produtos (o catálogo é sincronizado do PDV).
 *   npx tsx --env-file=.env scripts/diag-xeryus-catalogo.ts
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const refs = ["21950", "21952", "21961", "21967", "21986", "21987", "22012", "22014", "22016", "22022", "22027"];
  const ps = await prisma.produto.findMany({ where: { referenciaFornecedor: { in: refs } } });
  console.log("Produtos no nosso banco para essas referências (ref | modelo | fornecedor | campos de data):");
  for (const p of ps as any[]) {
    const datas = Object.entries(p).filter(([, v]) => v instanceof Date).map(([k, v]) => `${k}=${(v as Date).toISOString()}`).join(" ");
    console.log(`  ${p.referenciaFornecedor} | ${p.modeloNome} | ${p.fornecedorNome} | ${datas}`);
  }
  console.log(`(encontrados ${ps.length})`);
  const dist = await prisma.produto.groupBy({ by: ["modeloNome"], where: { fornecedorNome: { contains: "XERYUS", mode: "insensitive" } }, _count: true });
  console.log("\nModelos dos produtos Xeryus no nosso banco:", dist.map((d) => `${d.modeloNome}=${d._count}`).join(" ; "));
  const itens = await prisma.$queryRaw<{ cod: string; modelo: string | null; ref: string | null; tem: boolean }[]>`
    SELECT ni."codigoProduto" AS cod, ni."modeloIdentificado" AS modelo, ni."referenciaFornecedorIdentificada" AS ref, ni."temCadastro" AS tem
    FROM "NotaItem" ni JOIN "Note" n ON n.id = ni."noteId"
    WHERE n."emitenteNome" ILIKE 'XERYUS%' AND ni."codigoProduto" IN ('21950','22012')`;
  console.log("\nNotaItem (cod | modelo gerado | ref gerada | temCadastro):");
  for (const i of itens) console.log(`  ${i.cod} | ${i.modelo} | ${i.ref} | ${i.tem}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
