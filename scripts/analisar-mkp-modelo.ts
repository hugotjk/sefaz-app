/**
 * Análise SOMENTE LEITURA (não grava nada, não chama a API do PDV): descobre o padrão de
 * markup (preço de venda no PDV / custo total da nota) e como o PDV nomeia descrição e cor
 * de um modelo, usando só o que já está no banco do app.
 *
 *   npx tsx --env-file=.env scripts/analisar-mkp-modelo.ts --modelo=HAVAIANAS
 *   Opções: --rede=2  --amostras=25
 *
 * Saída: (1) contagem dos markups mais comuns (sobre custo total e sobre custo bruto),
 * (2) quantos preços terminam em ,99, (3) markup por emitente, (4) amostras:
 * descrição da NF x nome no PDV x cor no PDV.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db";
import { detalhesDoXml, type ItemBase } from "../src/lib/exportar-cadastro-produtos";

const arg = (n: string) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3);
const MODELO = (arg("modelo") ?? "").trim();
const REDE = arg("rede") ? Number(arg("rede")) : 2;
const AMOSTRAS = Number(arg("amostras") ?? 25);

const r2 = (v: number) => Math.round(v * 100) / 100;
const moda = (vals: number[]) => {
  const c = new Map<number, number>();
  for (const v of vals) c.set(v, (c.get(v) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
};
const contar = <T>(xs: T[]) => {
  const c = new Map<T, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
};

async function main() {
  if (!MODELO) throw new Error("use --modelo=NOME (ex.: HAVAIANAS)");

  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT i.id, i."noteId" AS note_id,
           regexp_replace(i."codigoProduto", '[^[:print:]]', ' ', 'g') AS codigo,
           regexp_replace(i."descricao", '[^[:print:]]', ' ', 'g') AS descricao,
           i.ean, i.ncm,
           i.quantidade::float8 AS qtd, i."valorUnitario"::float8 AS vun, i."valorTotal"::float8 AS vtot,
           i."modeloIdentificado" AS modelo, i."referenciaFornecedorIdentificada" AS referencia,
           regexp_replace(COALESCE(n."emitenteNome", ''), '[^[:print:]]', ' ', 'g') AS emitente,
           n.numero AS numero, n."dataEmissao" AS data
    FROM "NotaItem" i
    JOIN "Note" n ON n.id = i."noteId"
    WHERE i."temCadastro" = true
      AND i."modeloIdentificado" ILIKE ${"%" + MODELO + "%"}
      AND i."referenciaFornecedorIdentificada" IS NOT NULL
    ORDER BY n."dataEmissao" DESC NULLS LAST, i.id
  `);
  console.log(`Itens de nota já cadastrados do modelo "${MODELO}": ${rows.length}`);
  if (!rows.length) return;

  // Um item representativo por (modelo, referência): o mais recente.
  const porRef = new Map<string, any>();
  for (const r of rows) {
    const k = `${String(r.modelo).toUpperCase()}|${String(r.referencia).toUpperCase()}`;
    if (!porRef.has(k)) porRef.set(k, r);
  }
  const reps = [...porRef.values()];
  console.log(`Referências distintas: ${reps.length}`);

  const itensBase: ItemBase[] = reps.map((r) => ({
    id: r.id, noteId: r.note_id, codigo: r.codigo ?? "", descricao: r.descricao ?? "", ean: r.ean, ncm: r.ncm,
    infAdProd: null, quantidade: Number(r.qtd), valorUnitario: Number(r.vun), valorTotal: Number(r.vtot),
    modelo: r.modelo, referencia: r.referencia, emitente: r.emitente || null, data: r.data,
  }));
  const detalhes = await detalhesDoXml(itensBase);

  // Produtos do PDV (rede escolhida) com variações e preço de varejo, por (modelo, referência).
  const refs = [...new Set(reps.map((r) => String(r.referencia).toUpperCase().trim()))];
  const pr = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT p.id AS pid, UPPER(BTRIM(p."referenciaFornecedor")) AS ref, UPPER(BTRIM(p."modeloNome")) AS modelo,
           p.nome AS nome, v.tamanho, v.cor, pv.preco::float8 AS preco, pv."precoPromocional"::float8 AS promo
    FROM "Produto" p
    LEFT JOIN "VariacaoProduto" v ON v."produtoId" = p.id
    LEFT JOIN "PrecoVariacao" pv ON pv."variacaoId" = v.id
    WHERE UPPER(BTRIM(p."referenciaFornecedor")) = ANY(${refs}::text[])
      AND p."redeId" = ${REDE}
  `);
  const pdv = new Map<string, any[]>();
  for (const x of pr) {
    const k = `${x.modelo}|${x.ref}`;
    const l = pdv.get(k) ?? [];
    l.push(x);
    pdv.set(k, l);
  }

  interface Linha { ref: string; emitente: string; descNf: string; nomePdv: string; cores: string; bruto: number; total: number | null; preco: number; mkpTotal: number | null; mkpBruto: number }
  const linhas: Linha[] = [];
  for (const r of reps) {
    const lista = pdv.get(`${String(r.modelo).toUpperCase().trim()}|${String(r.referencia).toUpperCase().trim()}`) ?? [];
    const comPreco = lista.filter((x) => x.preco != null && x.preco > 0);
    if (!comPreco.length) continue;
    const preco = moda(comPreco.map((x) => r2(x.promo ? x.promo : x.preco)));
    if (preco == null) continue;
    const det = detalhes.get(r.id);
    const qtd = Number(r.qtd) || 1;
    const bruto = Number(r.vun);
    const total = det ? (Number(r.vtot) - det.desconto + det.ipi + det.icmsSt) / qtd : null;
    linhas.push({
      ref: r.referencia, emitente: r.emitente, descNf: r.descricao, nomePdv: (lista[0].nome ?? "").trim(),
      cores: [...new Set(lista.map((x) => (x.cor ?? "").trim()).filter(Boolean))].join(" | "),
      bruto, total, preco,
      mkpTotal: total ? r2(preco / total) : null,
      mkpBruto: bruto ? r2(preco / bruto) : 0,
    });
  }
  console.log(`Referências com preço no PDV (rede ${REDE}): ${linhas.length}\n`);
  if (!linhas.length) return;

  const fmt = (xs: [number | null, number][], n = 12) => xs.slice(0, n).map(([k, c]) => `  ${k}  → ${c}x`).join("\n");
  console.log("=== MARKUP sobre CUSTO TOTAL (preço PDV / custo com desconto, IPI e ST) — mais comuns ===");
  console.log(fmt(contar(linhas.map((l) => l.mkpTotal))));
  console.log("\n=== MARKUP sobre CUSTO BRUTO (preço PDV / valor unitário da nota) — mais comuns ===");
  console.log(fmt(contar(linhas.map((l) => l.mkpBruto))));

  const fim99 = linhas.filter((l) => Math.abs((l.preco * 100) % 1000 - 999) < 1).length;
  console.log(`\nPreços terminando em ,99 (x9,99): ${fim99} de ${linhas.length}`);
  console.log("Preços de venda mais comuns:");
  console.log(fmt(contar(linhas.map((l) => l.preco))));

  console.log("\n=== Por emitente ===");
  const porEmit = new Map<string, Linha[]>();
  for (const l of linhas) porEmit.set(l.emitente, [...(porEmit.get(l.emitente) ?? []), l]);
  for (const [e, ls] of porEmit) {
    const top = contar(ls.map((l) => l.mkpTotal)).slice(0, 3).map(([k, c]) => `${k} (${c}x)`).join(", ");
    console.log(`  ${e}: ${ls.length} refs | mkp total mais comum: ${top}`);
  }

  console.log(`\n=== Amostras: descrição da NF x nome no PDV x cor no PDV (até ${AMOSTRAS}) ===`);
  for (const l of linhas.slice(0, AMOSTRAS)) {
    console.log(`  ref ${l.ref} | custo bruto ${r2(l.bruto)} total ${l.total == null ? "?" : r2(l.total)} | PDV ${l.preco} | mkp ${l.mkpTotal ?? "?"}`);
    console.log(`     NF : ${l.descNf}`);
    console.log(`     PDV: ${l.nomePdv} | cor(es): ${l.cores || "—"}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
