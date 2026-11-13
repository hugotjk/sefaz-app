/**
 * SOMENTE LEITURA: estuda o fornecedor R DOIS (Reef, Champion, R Dois chinelos etc.).
 *   npx tsx --env-file=.env scripts/estudo-rdois.ts
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

async function main() {
  // 1) Catálogo: modelos e referências dos produtos desse fornecedor
  const forn = await prisma.produto.groupBy({ by: ["fornecedorNome"], where: { fornecedorNome: { contains: "R DOIS", mode: "insensitive" } }, _count: true });
  console.log("Fornecedores R DOIS no catálogo:", forn.map((f) => `${f.fornecedorNome}=${f._count}`).join(" ; "));
  const mods = await prisma.produto.groupBy({ by: ["modeloNome"], where: { fornecedorNome: { contains: "R DOIS", mode: "insensitive" } }, _count: true, orderBy: { _count: { modeloNome: "desc" } } });
  console.log("\nModelos no catálogo (produtos):", mods.map((m) => `${m.modeloNome}=${m._count}`).join(" ; "));
  for (const m of mods.slice(0, 8)) {
    const am = await prisma.produto.findMany({ where: { fornecedorNome: { contains: "R DOIS", mode: "insensitive" }, modeloNome: m.modeloNome }, take: 8, select: { referenciaFornecedor: true, nome: true } });
    console.log(`\n  [${m.modeloNome}] amostra do catálogo (referência | nome):`);
    for (const p of am) console.log(`    ${p.referenciaFornecedor} | ${p.nome}`);
  }

  // 2) Notas: itens e o que o app gera hoje
  const itens = await prisma.$queryRaw<{ cod: string; descricao: string; ean: string | null; modelo: string | null; ref: string | null; tem: boolean }[]>`
    SELECT ni."codigoProduto" AS cod, ni.descricao, ni.ean, ni."modeloIdentificado" AS modelo,
           ni."referenciaFornecedorIdentificada" AS ref, ni."temCadastro" AS tem
    FROM "NotaItem" ni JOIN "Note" n ON n.id = ni."noteId"
    WHERE n."emitenteNome" ILIKE 'R DOIS%'`;
  console.log(`\n\nItens de nota R DOIS: ${itens.length} | com cadastro: ${itens.filter((i) => i.tem).length}`);

  // 3) Pares via EAN: o que o catálogo diz x o que geramos
  const pares = await prisma.$queryRaw<{ cod: string; descricao: string; ref: string | null; modelo: string | null; refcat: string | null; modcat: string | null }[]>`
    SELECT DISTINCT ni."codigoProduto" AS cod, ni.descricao, ni."referenciaFornecedorIdentificada" AS ref, ni."modeloIdentificado" AS modelo,
           p."referenciaFornecedor" AS refcat, p."modeloNome" AS modcat
    FROM "NotaItem" ni JOIN "Note" n ON n.id = ni."noteId"
    JOIN "VariacaoProduto" v ON v.ean = ni.ean JOIN "Produto" p ON p.id = v."produtoId"
    WHERE n."emitenteNome" ILIKE 'R DOIS%' AND ni.ean IS NOT NULL AND ni.ean <> ''`;
  console.log(`Pares via EAN: ${pares.length}`);
  const refOk = pares.filter((p) => up(p.ref) === up(p.refcat)).length;
  const modOk = pares.filter((p) => up(p.modelo) === up(p.modcat)).length;
  console.log(`  referência gerada = catálogo: ${refOk}/${pares.length} | modelo gerado = catálogo: ${modOk}/${pares.length}`);
  const porMod = new Map<string, number>();
  for (const p of pares) porMod.set(`${p.modelo} -> catálogo ${p.modcat}`, (porMod.get(`${p.modelo} -> catálogo ${p.modcat}`) ?? 0) + 1);
  console.log("  Modelo gerado -> modelo no catálogo:");
  for (const [k, v] of [...porMod.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(5)}  ${k}`);

  console.log("\nAmostra de pares onde a REFERÊNCIA difere (código | descrição | gerada | catálogo | modelo cat.):");
  let n = 0;
  for (const p of pares) {
    if (up(p.ref) === up(p.refcat)) continue;
    console.log(`  ${p.cod} | ${p.descricao} | ${p.ref} | ${p.refcat} | ${p.modcat}`);
    if (++n >= 40) break;
  }

  console.log("\nItens SEM cadastro (código | descrição | modelo gerado | ref gerada) — amostra:");
  const sem = itens.filter((i) => !i.tem);
  const vistos = new Set<string>();
  for (const i of sem) {
    if (vistos.has(i.cod)) continue;
    vistos.add(i.cod);
    console.log(`  ${i.cod} | ${i.descricao} | ${i.modelo} | ${i.ref}`);
    if (vistos.size >= 40) break;
  }
  console.log(`Total sem cadastro: ${sem.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
