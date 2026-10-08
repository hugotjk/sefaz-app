/**
 * SOMENTE-LEITURA. Gera `modelos-mkp.csv` (na pasta onde você rodar) com TODOS
 * os modelos — do PDV e das notas — para você preencher o markup base e as
 * exceções. Abre direto no Excel (UTF-8, separador ";").
 *
 *   npx tsx --env-file=.env scripts/exportar-modelos-mkp.ts
 *
 * Ordem: modelos com mais itens nas notas dos últimos 90 dias primeiro.
 */
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const chave = (s: string) => s.trim().toUpperCase();
const csv = (v: unknown) => {
  const t = v == null ? "" : String(v);
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

async function main() {
  const pdv = await prisma.$queryRaw<{ modelo: string; n: number; forn: string | null }[]>`
    SELECT "modeloNome" AS modelo, COUNT(*)::int AS n,
           mode() WITHIN GROUP (ORDER BY "fornecedorNome") AS forn
    FROM "Produto" WHERE "modeloNome" IS NOT NULL AND trim("modeloNome") <> ''
    GROUP BY 1`;
  const grupos = await prisma.$queryRaw<{ modelo: string; grupo: string; n: number }[]>`
    SELECT "modeloNome" AS modelo, "grupoNome" AS grupo, COUNT(*)::int AS n
    FROM "Produto"
    WHERE "modeloNome" IS NOT NULL AND trim("modeloNome") <> '' AND "grupoNome" IS NOT NULL
    GROUP BY 1, 2`;
  const notas = await prisma.$queryRaw<{ modelo: string; total: number; r90: number; emit: string | null }[]>`
    SELECT i."modeloIdentificado" AS modelo, COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE n."dataEmissao" >= now() - interval '90 days')::int AS r90,
           mode() WITHIN GROUP (ORDER BY n."emitenteNome") AS emit
    FROM "NotaItem" i JOIN "Note" n ON n.id = i."noteId"
    WHERE COALESCE(i."modeloIdentificado", '') <> ''
    GROUP BY 1`;

  type Linha = { nome: string; produtos: number; total: number; r90: number; forn: string; grupos: string };
  const mapa = new Map<string, Linha>();
  const topGrupos = new Map<string, { grupo: string; n: number }[]>();
  for (const g of grupos) {
    const k = chave(g.modelo);
    const l = topGrupos.get(k) ?? [];
    l.push({ grupo: g.grupo, n: g.n });
    topGrupos.set(k, l);
  }
  for (const p of pdv) {
    const k = chave(p.modelo);
    const ex = mapa.get(k);
    if (ex) {
      ex.produtos += p.n;
      continue;
    }
    const tg = (topGrupos.get(k) ?? []).sort((a, b) => b.n - a.n).slice(0, 3).map((x) => `${x.grupo} (${x.n})`).join(", ");
    mapa.set(k, { nome: p.modelo, produtos: p.n, total: 0, r90: 0, forn: p.forn ?? "", grupos: tg });
  }
  for (const n of notas) {
    const k = chave(n.modelo);
    const ex = mapa.get(k) ?? { nome: n.modelo, produtos: 0, total: 0, r90: 0, forn: n.emit ?? "", grupos: "" };
    ex.total += n.total;
    ex.r90 += n.r90;
    if (!ex.forn) ex.forn = n.emit ?? "";
    mapa.set(k, ex);
  }

  const linhas = [...mapa.values()].sort(
    (a, b) => b.r90 - a.r90 || b.total - a.total || b.produtos - a.produtos || a.nome.localeCompare(b.nome, "pt-BR")
  );

  const cab = [
    "Modelo", "Origem", "Produtos no PDV", "Itens nas notas (90 dias)", "Itens nas notas (total)",
    "Fornecedor mais comum", "Grupos mais comuns (PDV)",
    "MKP base", "MKP alternativo 1", "Condição do alternativo 1", "MKP alternativo 2", "Condição do alternativo 2",
    "Final do preço (9,99 / 4,99 / 9,00 / ,90)", "Observações",
  ];
  const rows = linhas.map((l) => [
    l.nome,
    l.produtos && l.total ? "PDV + notas" : l.produtos ? "só PDV" : "só notas (sem cadastro no PDV)",
    l.produtos, l.r90, l.total, l.forn, l.grupos, "", "", "", "", "", "", "",
  ]);
  const texto = [cab, ...rows].map((r) => r.map(csv).join(";")).join("\r\n");
  writeFileSync("modelos-mkp.csv", "﻿" + texto, "utf8");
  console.log(`modelos-mkp.csv gerado com ${linhas.length} modelos.`);
  console.log(`  com itens nas notas dos últimos 90 dias: ${linhas.filter((l) => l.r90 > 0).length}`);
  console.log(`  só nas notas (sem produto no PDV): ${linhas.filter((l) => !l.produtos).length}`);
}

main()
  .catch((e) => {
    console.error("Falhou:", String(e?.message ?? e).slice(0, 400));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
