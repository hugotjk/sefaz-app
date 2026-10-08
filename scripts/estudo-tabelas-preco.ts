/**
 * ESTUDO SOMENTE-LEITURA (não grava nada): lê da API do PDV as tabelas de
 * preço e mostra qual é qual (1 custo bruto, 2 custo total, 3 venda, 7, 9),
 * como são os preços de cada uma e — numa amostra — o markup direto do PDV
 * (preço da tabela 3 / preço da tabela 1) por modelo, sem depender de notas.
 *
 *   npx tsx --env-file=.env scripts/estudo-tabelas-preco.ts
 *
 * Opcional: PAGINAS=120 (padrão 80 páginas espalhadas x 50 = 4.000 preços por tabela).
 */
import { PrismaClient } from "@prisma/client";
import { listarTabelasPreco, listarPrecos } from "../src/lib/pdvapi";

const prisma = new PrismaClient();
const PAGINAS = Number(process.env.PAGINAS || 80);

async function main() {
  console.log("==================== TABELAS DE PREÇO DO PDV ====================");
  const tabelas = await listarTabelasPreco(1);
  for (const t of tabelas) {
    console.log(`  ${String(t.Codigo).padStart(3)}  tipo=${t.Tipo}  ${t.Descricao}${t.Descricaofranquia ? `  (franquia: ${t.Descricaofranquia})` : ""}`);
  }

  // Amostra ESPALHADA: páginas igualmente espaçadas ao longo das tabelas 1 e 3
  // (quase do mesmo tamanho, então as mesmas páginas cobrem as mesmas variações),
  // em vez das primeiras linhas — que são sempre os produtos mais antigos.
  const porTabela = new Map<number, Map<string, number>>();
  const primeira = await listarPrecos(3, { pagina: 1, tamanhoPagina: 50 });
  const totalPag = primeira.paginacao?.TotalPaginas ?? 1;
  const paginas = [...new Set(Array.from({ length: PAGINAS }, (_, k) => 1 + Math.floor((k * (totalPag - 1)) / Math.max(1, PAGINAS - 1))))];
  console.log(`\n==================== AMOSTRA ESPALHADA (${paginas.length} páginas de ${totalPag}) ====================`);
  for (const cod of [1, 3]) {
    const mapa = new Map<string, number>();
    for (const pg of paginas) {
      const r = await listarPrecos(cod, { pagina: pg, tamanhoPagina: 50 });
      for (const p of r.registros) mapa.set(String(p.VariacaoId), Number(p.PrecoOriginal ?? 0));
    }
    porTabela.set(cod, mapa);
    console.log(`  tabela ${cod}: ${mapa.size} preços lidos`);
  }

  const t1 = porTabela.get(1)!;
  const t3 = porTabela.get(3)!;
  const comuns = [...t3.keys()].filter((id) => (t1.get(id) ?? 0) > 0 && (t3.get(id) ?? 0) > 0);
  console.log(`  variações com preço nas duas tabelas: ${comuns.length}`);

  const info = await prisma.$queryRaw<
    { id: string; produto: string; modelo: string | null; grupo: string | null }[]
  >`SELECT v.id, p.id AS produto, p."modeloNome" AS modelo, p."grupoNome" AS grupo
    FROM "VariacaoProduto" v JOIN "Produto" p ON p.id = v."produtoId"
    WHERE v.id = ANY(${comuns}::text[])`;

  // 1 observação por PRODUTO (mediana dos markups e dos preços das variações dele)
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const porProduto = new Map<string, { modelo: string; grupo: string; mks: number[]; precos: number[] }>();
  for (const i of info) {
    const o = porProduto.get(i.produto) ?? { modelo: i.modelo ?? "(sem modelo)", grupo: i.grupo ?? "-", mks: [], precos: [] };
    o.mks.push(t3.get(i.id)! / t1.get(i.id)!);
    o.precos.push(t3.get(i.id)!);
    porProduto.set(i.produto, o);
  }
  console.log(`  produtos distintos na amostra: ${porProduto.size}`);

  const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  const agrupa = (chave: (o: { modelo: string; grupo: string }) => string, minN: number, titulo: string) => {
    const g = new Map<string, number[]>();
    for (const o of porProduto.values()) {
      const k = chave(o);
      const l = g.get(k) ?? [];
      l.push(med(o.mks));
      g.set(k, l);
    }
    console.log(`\n${titulo} (1 ponto por PRODUTO; n = produtos)`);
    [...g.entries()]
      .map(([k, l]) => ({ k, n: l.length, s: [...l].sort((a, b) => a - b) }))
      .filter((x) => x.n >= minN)
      .sort((a, b) => b.n - a.n)
      .slice(0, 50)
      .forEach((x) => {
        const disp = (q(x.s, 0.75) - q(x.s, 0.25)) / q(x.s, 0.5);
        console.log(
          `  ${x.k.slice(0, 46).padEnd(46)} n=${String(x.n).padStart(4)}  mediana=${q(x.s, 0.5).toFixed(2)}  p25=${q(x.s, 0.25).toFixed(2)}  p75=${q(x.s, 0.75).toFixed(2)}  ${disp <= 0.05 ? "ESTÁVEL" : disp <= 0.2 ? "médio" : "VARIA"}`
        );
      });
  };
  console.log("\n==================== MARKUP DIRETO DO PDV (tabela 3 / tabela 1) ====================");
  agrupa((o) => o.modelo, 4, "Por MODELO");
  agrupa((o) => `${o.modelo} | ${o.grupo}`, 4, "Por MODELO | GRUPO");

  // Final do preço de venda (tabela 3) por modelo.
  console.log("\n==================== FINAL DO PREÇO (tabela 3) POR MODELO ====================");
  const fin = new Map<string, { n: number; x999: number; x900: number; c90: number; c99: number; outro: number }>();
  for (const o of porProduto.values()) {
    const v = Math.round(med(o.precos) * 100);
    const f = fin.get(o.modelo) ?? { n: 0, x999: 0, x900: 0, c90: 0, c99: 0, outro: 0 };
    f.n++;
    if (v % 1000 === 999) f.x999++;
    else if (v % 1000 === 900) f.x900++;
    else if (v % 100 === 90) f.c90++;
    else if (v % 100 === 99) f.c99++;
    else f.outro++;
    fin.set(o.modelo, f);
  }
  [...fin.entries()]
    .filter(([, f]) => f.n >= 4)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 30)
    .forEach(([m, f]) =>
      console.log(`  ${m.slice(0, 30).padEnd(30)} n=${String(f.n).padStart(4)}  x9,99=${f.x999}  x9,00=${f.x900}  ,90=${f.c90}  outro,99=${f.c99}  outros=${f.outro}`)
    );

  console.log("\nFim. Nada foi gravado.");
}

main()
  .catch((e) => {
    console.error("Falhou:", String(e?.message ?? e).slice(0, 400));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
