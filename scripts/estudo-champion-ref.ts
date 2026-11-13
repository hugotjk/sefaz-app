/**
 * SOMENTE LEITURA: testa regras "infAdProd sem espaço + cor" (máx. 20 caracteres) para a CHP BRANDS,
 * comparando com as referências JÁ cadastradas no catálogo (Produto.referenciaFornecedor).
 *   npx tsx --env-file=.env scripts/estudo-champion-ref.ts
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const up = (s: string) => s.toUpperCase();
const soAlfa = (s: string) => up(s).replace(/[^A-Z0-9]/g, "");
const ehTamanho = (w: string) => /\//.test(w) || /^(UNICO|UN|U|P|M|G|GG|XG|XGG|PP|\d{1,2})$/.test(up(w));

function variantes(inf: string, desc: string): Record<string, string> {
  const base = soAlfa(inf);
  let w = desc.trim().split(/\s+/);
  while (w.length && ehTamanho(w[w.length - 1])) w = w.slice(0, -1); // tira o tamanho do fim
  const cor = (n: number) => soAlfa(w.slice(-n).join(""));
  const o: Record<string, string> = {};
  for (const n of [1, 2, 3]) o[`ref + últimas ${n} palavra(s)`] = (base + cor(n)).slice(0, 20);
  o["só ref (sem cor)"] = base.slice(0, 20);
  return o;
}

async function main() {
  const prods = await prisma.produto.findMany({ where: { fornecedorNome: { contains: "CHP BRANDS", mode: "insensitive" } }, select: { referenciaFornecedor: true } });
  const catalogo = new Set(prods.map((p) => up(p.referenciaFornecedor ?? "")));
  console.log("Referências CHP no catálogo:", catalogo.size);

  const itens = await prisma.$queryRaw<{ cod: string; descricao: string; inf: string | null }[]>`
    SELECT DISTINCT ni."codigoProduto" AS cod, ni.descricao, ni."infAdProd" AS inf
    FROM "NotaItem" ni JOIN "Note" n ON n.id = ni."noteId"
    WHERE n."emitenteNome" ILIKE 'CHP BRANDS%'`;
  const comInf = itens.filter((i) => i.inf && i.inf.trim() && i.inf.trim() !== "0");
  console.log(`Itens distintos: ${itens.length} | com infAdProd: ${comInf.length}`);
  console.log("\nAmostra (infAdProd | descrição):");
  for (const i of comInf.slice(0, 12)) console.log(`  [${i.inf}] | ${i.descricao}`);

  const placar: Record<string, number> = {};
  for (const i of comInf) for (const [k, v] of Object.entries(variantes(i.inf!, i.descricao))) if (catalogo.has(up(v))) placar[k] = (placar[k] ?? 0) + 1;
  console.log("\nAcertos no catálogo (de " + comInf.length + "):");
  for (const [k, v] of Object.entries(placar).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);

  // Erros da melhor variante: mostra gerado x candidatos do catálogo com o mesmo prefixo
  const melhor = Object.entries(placar).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "ref + últimas 1 palavra(s)";
  console.log(`\nErros da melhor ("${melhor}") — gerado | descrição | no catálogo com mesmo prefixo:`);
  let n = 0;
  for (const i of comInf) {
    const g = variantes(i.inf!, i.descricao)[melhor];
    if (catalogo.has(up(g))) continue;
    const pref = soAlfa(i.inf!).slice(0, 12);
    const cands = [...catalogo].filter((c) => c.startsWith(pref)).slice(0, 4);
    console.log(`  ${g} | ${i.descricao} | ${cands.join(", ") || "(nenhum)"}`);
    if (++n >= 30) break;
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
