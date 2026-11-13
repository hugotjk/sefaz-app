/**
 * DIAGNÓSTICO SÓ DE LEITURA (não altera nada): como as referências da Rikam estão gravadas no
 * catálogo (Produto) e por que os itens recentes dela estão "com" ou "sem" cadastro.
 *
 *   npx tsx scripts/diag-referencia-rikam.ts
 *   npx tsx scripts/diag-referencia-rikam.ts UN.17200.99      (trecho da referência a procurar)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const trecho = (process.argv[2] ?? "UN").trim();

async function main() {
  // 1) Catálogo: produtos do modelo Rikam — com ponto ou sem ponto na referência
  const cat = await prisma.produto.findMany({
    where: { OR: [{ modeloNome: { equals: "Rikam", mode: "insensitive" } }, { fornecedorNome: { contains: "RIKAM", mode: "insensitive" } }] },
    select: { id: true, referenciaFornecedor: true, modeloNome: true, nome: true },
  });
  const comPonto = cat.filter((p) => (p.referenciaFornecedor ?? "").includes("."));
  console.log(`\n== Catálogo Rikam: ${cat.length} produtos | referência COM ponto: ${comPonto.length} | SEM ponto: ${cat.length - comPonto.length}`);
  console.log("Exemplos COM ponto:", comPonto.slice(0, 8).map((p) => p.referenciaFornecedor).join(" ; "));
  console.log("Exemplos SEM ponto:", cat.filter((p) => !(p.referenciaFornecedor ?? "").includes(".")).slice(0, 8).map((p) => p.referenciaFornecedor).join(" ; "));

  // 2) Produtos cujo ref contém o trecho pedido (ignora pontos)
  const t = trecho.replace(/\./g, "");
  const ach = await prisma.$queryRaw<{ id: string; ref: string | null; modelo: string | null; nome: string | null }[]>`
    SELECT id, "referenciaFornecedor" AS ref, "modeloNome" AS modelo, nome FROM "Produto"
    WHERE REPLACE(COALESCE("referenciaFornecedor",''), '.', '') ILIKE ${"%" + t + "%"} LIMIT 30`;
  console.log(`\n== Catálogo: referências que contêm "${trecho}" (ignorando pontos): ${ach.length}`);
  for (const a of ach) console.log(`  ${a.ref} | modelo=${a.modelo} | ${a.nome}`);

  // 3) Itens de nota da Rikam (últimos 60): código da nota, ref identificada, EAN no catálogo, ref+modelo no catálogo
  const itens = await prisma.$queryRaw<
    { cod: string; ref: string | null; modelo: string | null; ean: string | null; tem: boolean; eanNoCat: boolean; refNoCat: boolean }[]
  >`
    SELECT ni."codigoProduto" AS cod, ni."referenciaFornecedorIdentificada" AS ref, ni."modeloIdentificado" AS modelo,
           ni.ean, ni."temCadastro" AS tem,
           EXISTS (SELECT 1 FROM "VariacaoProduto" v WHERE v.ean = ni.ean) AS "eanNoCat",
           EXISTS (SELECT 1 FROM "Produto" p WHERE lower(trim(p."referenciaFornecedor")) = lower(trim(ni."referenciaFornecedorIdentificada"))
                   AND lower(p."modeloNome") = lower(ni."modeloIdentificado")) AS "refNoCat"
    FROM "NotaItem" ni
    WHERE ni."modeloIdentificado" ILIKE 'rikam'
    ORDER BY ni."createdAt" DESC LIMIT 60`;
  console.log(`\n== Itens recentes da Rikam (${itens.length}): cód nota -> ref identificada | EAN no catálogo | ref+modelo no catálogo | temCadastro`);
  for (const i of itens)
    console.log(`  ${i.cod} -> ${i.ref} | ean:${i.eanNoCat ? "SIM" : "não"} | ref+modelo:${i.refNoCat ? "SIM" : "não"} | tem:${i.tem}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
