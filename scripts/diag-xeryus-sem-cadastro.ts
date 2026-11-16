/**
 * SOMENTE LEITURA. Explica por que itens de Xeryus/Radu continuam "sem cadastro":
 * para cada NotaItem com temCadastro=false, compara referência+modelo
 * identificados com o catálogo local (Produto) e classifica:
 *   A) existe Produto com a mesma referência E o mesmo modelo (flag desatualizada)
 *   B) existe Produto com a mesma referência, mas OUTRO modelo (cadastro no PDV com modelo diferente)
 *   C) não existe nenhum Produto com essa referência no catálogo local
 *
 *   npx tsx --env-file=.env scripts/diag-xeryus-sem-cadastro.ts
 */
import { prisma } from "../src/lib/db";

const ALVOS = [
  "XERYUS IMP. DISTRIB. DE ARTIGOS P/ VESTUARIO LTDA",
  "RADU INDUSTRIA IMPORTACAO E EXPORTACAO LTDA",
];

async function main() {
  const itens = await prisma.notaItem.findMany({
    where: {
      temCadastro: false,
      OR: ALVOS.map((a) => ({ note: { emitenteNome: { equals: a, mode: "insensitive" as const } } })),
    },
    select: {
      codigoProduto: true, descricao: true, ean: true,
      modeloIdentificado: true, referenciaFornecedorIdentificada: true,
      note: { select: { emitenteNome: true } },
    },
  });
  console.log(`Itens sem cadastro (Xeryus/Radu): ${itens.length}\n`);

  const refs = [...new Set(itens.map((i) => (i.referenciaFornecedorIdentificada ?? "").trim().toUpperCase()).filter(Boolean))];
  const prods = refs.length
    ? await prisma.$queryRaw<{ ref: string; modelo: string | null; redeId: number | null }[]>`
        SELECT upper(trim("referenciaFornecedor")) AS ref, "modeloNome" AS modelo, "redeId"
          FROM "Produto"
         WHERE upper(trim("referenciaFornecedor")) = ANY(${refs}::text[])`
    : [];
  const porRef = new Map<string, { modelo: string | null; redeId: number | null }[]>();
  for (const p of prods) {
    const l = porRef.get(p.ref) ?? [];
    l.push({ modelo: p.modelo, redeId: p.redeId });
    porRef.set(p.ref, l);
  }

  const cat: Record<"A" | "B" | "C" | "semRef", typeof itens> = { A: [], B: [], C: [], semRef: [] };
  for (const i of itens) {
    const ref = (i.referenciaFornecedorIdentificada ?? "").trim().toUpperCase();
    const mod = (i.modeloIdentificado ?? "").trim().toUpperCase();
    if (!ref) { cat.semRef.push(i); continue; }
    const ps = porRef.get(ref) ?? [];
    if (ps.length === 0) cat.C.push(i);
    else if (ps.some((p) => (p.modelo ?? "").trim().toUpperCase() === mod)) cat.A.push(i);
    else cat.B.push(i);
  }

  const resumo = (nome: string, l: typeof itens, extra?: (i: (typeof itens)[number]) => string) => {
    console.log(`\n=== ${nome}: ${l.length} itens ===`);
    const porEmit = new Map<string, number>();
    l.forEach((i) => porEmit.set(i.note.emitenteNome ?? "?", (porEmit.get(i.note.emitenteNome ?? "?") ?? 0) + 1));
    console.log("  por fornecedor:", Object.fromEntries(porEmit));
    const refsUn = new Map<string, number>();
    l.forEach((i) => { const k = i.referenciaFornecedorIdentificada ?? "(vazio)"; refsUn.set(k, (refsUn.get(k) ?? 0) + 1); });
    console.log(`  referências distintas: ${refsUn.size}`);
    l.slice(0, 12).forEach((i) =>
      console.log(`  - ref "${i.referenciaFornecedorIdentificada}" modelo "${i.modeloIdentificado}" | ${i.descricao.slice(0, 50)}${extra ? " | " + extra(i) : ""}`)
    );
  };

  resumo("A) ref+modelo existem no catálogo (flag desatualizada)", cat.A);
  resumo("B) ref existe, mas com OUTRO modelo no catálogo", cat.B, (i) => {
    const ps = porRef.get((i.referenciaFornecedorIdentificada ?? "").trim().toUpperCase()) ?? [];
    return "catálogo: " + [...new Set(ps.map((p) => `${p.modelo ?? "(vazio)"}@rede${p.redeId}`))].join(", ");
  });
  resumo("C) ref NÃO existe no catálogo local", cat.C);
  resumo("Sem referência identificada", cat.semRef);
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
