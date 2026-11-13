/**
 * SOMENTE LEITURA: agrupa os itens de nota da R DOIS pelas 3 primeiras palavras da descrição,
 * para ver quais linhas existem (Reef, Champion, Thug Nine, Flamengo...) e quantas têm cadastro.
 *   npx tsx --env-file=.env scripts/estudo-rdois-grupos.ts
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const itens = await prisma.$queryRaw<{ cod: string; descricao: string; modelo: string | null; ref: string | null; tem: boolean }[]>`
    SELECT ni."codigoProduto" AS cod, ni.descricao, ni."modeloIdentificado" AS modelo,
           ni."referenciaFornecedorIdentificada" AS ref, ni."temCadastro" AS tem
    FROM "NotaItem" ni JOIN "Note" n ON n.id = ni."noteId"
    WHERE n."emitenteNome" ILIKE 'R DOIS%'`;
  const g = new Map<string, { n: number; tem: number; cods: Set<string>; ex: typeof itens[number] }>();
  for (const i of itens) {
    const k = i.descricao.trim().toUpperCase().split(/\s+/).slice(0, 3).join(" ");
    const x = g.get(k) ?? { n: 0, tem: 0, cods: new Set(), ex: i };
    x.n++;
    if (i.tem) x.tem++;
    x.cods.add(i.cod);
    g.set(k, x);
  }
  console.log(`Itens: ${itens.length} | grupos: ${g.size}\n(itens | com cadastro | grupo | exemplo: código | descrição | ref gerada)`);
  for (const [k, x] of [...g.entries()].sort((a, b) => b[1].n - a[1].n))
    console.log(`${String(x.n).padStart(4)} | ${String(x.tem).padStart(4)} | ${k} | ${x.ex.cod} | ${x.ex.descricao.slice(0, 70)} | ${x.ex.ref}`);

  // Itens com cadastro: referência gerada x código (para ver o que já funciona)
  const ok = itens.filter((i) => i.tem).slice(0, 12);
  console.log("\nExemplos COM cadastro (código | ref gerada | descrição):");
  for (const i of ok) console.log(`  ${i.cod} | ${i.ref} | ${i.descricao.slice(0, 70)}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
