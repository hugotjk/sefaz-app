/**
 * ESTUDO SOMENTE-LEITURA (não grava nada): lê da API do PDV as tabelas de
 * preço e mostra qual é qual (1 custo bruto, 2 custo total, 3 venda, 7, 9),
 * como são os preços de cada uma e — numa amostra — o markup direto do PDV
 * (preço da tabela 3 / preço da tabela 1) por modelo, sem depender de notas.
 *
 *   npx tsx --env-file=.env scripts/estudo-tabelas-preco.ts
 *
 * Opcional: PAGINAS=120 (padrão 60 páginas x 50 = 3.000 preços por tabela).
 */
import { PrismaClient } from "@prisma/client";
import { listarTabelasPreco, listarPrecos } from "../src/lib/pdvapi";

const prisma = new PrismaClient();
const PAGINAS = Number(process.env.PAGINAS || 60);
const TABELAS_ALVO = [1, 2, 3, 7, 9];

const fmt = (n: number | undefined) => (n == null ? "—" : n.toFixed(2));

async function main() {
  console.log("==================== TABELAS DE PREÇO DO PDV ====================");
  const tabelas = await listarTabelasPreco(1);
  for (const t of tabelas) {
    console.log(`  ${String(t.Codigo).padStart(3)}  tipo=${t.Tipo}  ${t.Descricao}${t.Descricaofranquia ? `  (franquia: ${t.Descricaofranquia})` : ""}`);
  }

  const codigos = TABELAS_ALVO.filter((c) => tabelas.some((t) => t.Codigo === c));
  const faltando = TABELAS_ALVO.filter((c) => !codigos.includes(c));
  if (faltando.length) console.log(`\nAtenção: tabelas ${faltando.join(", ")} não existem na lista acima.`);

  // preços por tabela: variacaoId -> { orig, promo }
  const porTabela = new Map<number, Map<string, { orig: number; promo?: number }>>();
  console.log(`\n==================== AMOSTRA (${PAGINAS} páginas x 50 por tabela) ====================`);
  for (const cod of codigos) {
    const mapa = new Map<string, { orig: number; promo?: number }>();
    let total: number | undefined;
    for (let pg = 1; pg <= PAGINAS; pg++) {
      const r = await listarPrecos(cod, { pagina: pg, tamanhoPagina: 50 });
      for (const p of r.registros) mapa.set(String(p.VariacaoId), { orig: Number(p.PrecoOriginal ?? 0), promo: p.PrecoPromocional != null ? Number(p.PrecoPromocional) : undefined });
      total = (r.paginacao as any)?.TotalRegistros ?? total;
      if (!r.paginacao?.TemProximaPagina || r.registros.length === 0) break;
    }
    porTabela.set(cod, mapa);
    const vals = [...mapa.values()].map((v) => v.orig).filter((v) => v > 0);
    const f999 = vals.filter((v) => Math.round(v * 100) % 1000 === 999).length;
    const f900 = vals.filter((v) => Math.round(v * 100) % 1000 === 900).length;
    const f99 = vals.filter((v) => Math.round(v * 100) % 100 === 99).length;
    console.log(
      `  tabela ${cod}: ${mapa.size} preços lidos${total ? ` (total na tabela: ${total})` : ""}; com preço>0: ${vals.length}; terminam x9,99: ${f999}, ,99: ${f99}, x9,00: ${f900}`
    );
    console.log(`     exemplos: ${[...mapa.entries()].slice(0, 4).map(([id, v]) => `${id.slice(0, 8)}…=${fmt(v.orig)}`).join("  ")}`);
  }

  // Markup direto do PDV: preço da tabela 3 / preço da tabela 1, nas variações em comum.
  const t1 = porTabela.get(1);
  const t3 = porTabela.get(3);
  if (t1 && t3) {
    const comuns = [...t3.keys()].filter((id) => (t1.get(id)?.orig ?? 0) > 0 && (t3.get(id)?.orig ?? 0) > 0);
    console.log(`\n==================== MARKUP DIRETO DO PDV (tabela 3 / tabela 1) ====================`);
    console.log(`Variações com preço nas duas tabelas (na amostra): ${comuns.length}`);
    if (comuns.length) {
      const info = await prisma.$queryRaw<{ id: string; modelo: string | null; grupo: string | null }[]>`
        SELECT v.id, p."modeloNome" AS modelo, p."grupoNome" AS grupo
        FROM "VariacaoProduto" v JOIN "Produto" p ON p.id = v."produtoId"
        WHERE v.id = ANY(${comuns}::text[])`;
      const porModelo = new Map<string, number[]>();
      for (const i of info) {
        const mk = t3.get(i.id)!.orig / t1.get(i.id)!.orig;
        const k = `${i.modelo ?? "(sem modelo)"} | ${i.grupo ?? "-"}`;
        const l = porModelo.get(k) ?? [];
        l.push(mk);
        porModelo.set(k, l);
      }
      const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
      const linhas = [...porModelo.entries()]
        .map(([k, l]) => ({ k, n: l.length, s: [...l].sort((a, b) => a - b) }))
        .filter((x) => x.n >= 3)
        .sort((a, b) => b.n - a.n)
        .slice(0, 60);
      for (const x of linhas) {
        const disp = (q(x.s, 0.75) - q(x.s, 0.25)) / q(x.s, 0.5);
        console.log(
          `  ${x.k.slice(0, 46).padEnd(46)} n=${String(x.n).padStart(4)}  mediana=${q(x.s, 0.5).toFixed(2)}  p25=${q(x.s, 0.25).toFixed(2)}  p75=${q(x.s, 0.75).toFixed(2)}  ${disp <= 0.05 ? "ESTÁVEL" : disp <= 0.2 ? "médio" : "VARIA"}`
        );
      }
    }
  }

  console.log("\nFim. Nada foi gravado.");
}

main()
  .catch((e) => {
    console.error("Falhou:", String(e?.message ?? e).slice(0, 400));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
