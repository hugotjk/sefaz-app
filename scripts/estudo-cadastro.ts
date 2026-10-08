/**
 * ESTUDO SOMENTE-LEITURA (não grava nada) para automatizar o cadastro de
 * produtos novos a partir das notas:
 *   1. GRUPO  — quais grupos existem no PDV, como são os nomes dos produtos e
 *               quanto acerta uma regra "palavra da descrição -> grupo".
 *   2. MARKUP — preço de venda do PDV / custo da NF por modelo (e por modelo +
 *               grupo), para ver onde o markup é estável o bastante p/ virar regra.
 *   3. FINAL DO PREÇO — quanto dos preços do PDV termina em x9,99 / x4,99.
 *
 *   npx tsx --env-file=.env scripts/estudo-cadastro.ts
 *
 * Tudo é impresso no terminal; pode colar o resultado de volta no chat.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const tokens = (s: string) =>
  [...new Set(semAcento(s).toUpperCase().split(/[^A-Z]+/).filter((t) => t.length >= 3))];
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

async function estudoGrupo() {
  console.log("==================== 1. GRUPO ====================");
  const prods = await prisma.$queryRaw<{ id: string; nome: string; grupo: string }[]>`
    SELECT id, nome, "grupoNome" AS grupo FROM "Produto"
    WHERE nome IS NOT NULL AND trim(nome) <> '' AND "grupoNome" IS NOT NULL AND trim("grupoNome") <> ''`;
  console.log(`Produtos com nome e grupo: ${prods.length}`);

  const porGrupo = new Map<string, typeof prods>();
  for (const p of prods) {
    const l = porGrupo.get(p.grupo) ?? [];
    l.push(p);
    porGrupo.set(p.grupo, l);
  }
  const grupos = [...porGrupo.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(`Grupos distintos: ${grupos.length}\n`);

  console.log("Top 30 grupos (qtd | % dos nomes que COMEÇAM com o nome do grupo | exemplos):");
  for (const [g, l] of grupos.slice(0, 30)) {
    const gU = semAcento(g).toUpperCase();
    const comeca = l.filter((p) => semAcento(p.nome).toUpperCase().startsWith(gU)).length;
    const ex = [...l].sort((a, b) => hash(a.id) - hash(b.id)).slice(0, 3).map((p) => p.nome.slice(0, 45));
    console.log(`  ${g.padEnd(24)} ${String(l.length).padStart(6)} | ${pct(comeca, l.length).padStart(6)} | ${ex.join("  ·  ")}`);
  }

  // Classificador por palavra: treino em 80% (por hash do id), teste em 20%.
  const treino = prods.filter((p) => hash(p.id) % 5 !== 0);
  const teste = prods.filter((p) => hash(p.id) % 5 === 0);
  const cont = new Map<string, Map<string, number>>(); // token -> grupo -> n
  for (const p of treino) {
    for (const t of tokens(p.nome)) {
      const m = cont.get(t) ?? new Map<string, number>();
      m.set(p.grupo, (m.get(p.grupo) ?? 0) + 1);
      cont.set(t, m);
    }
  }
  const MIN_SUPORTE = 15;
  const regra = new Map<string, { grupo: string; pureza: number; n: number }>();
  for (const [t, m] of cont) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    if (total < MIN_SUPORTE) continue;
    const [g, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n / total >= 0.9) regra.set(t, { grupo: g, pureza: n / total, n: total });
  }
  let cobertos = 0;
  let certos = 0;
  const erros = new Map<string, number>();
  for (const p of teste) {
    // vence a palavra de maior suporte entre as que têm regra
    const achados = tokens(p.nome)
      .map((t) => regra.get(t))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .sort((a, b) => b.n - a.n);
    if (!achados.length) continue;
    cobertos++;
    if (achados[0].grupo === p.grupo) certos++;
    else {
      const k = `${p.grupo}  <-  previsto ${achados[0].grupo}`;
      erros.set(k, (erros.get(k) ?? 0) + 1);
    }
  }
  console.log(`\nRegra "palavra da descrição -> grupo" (pureza >= 90%, suporte >= ${MIN_SUPORTE}):`);
  console.log(`  palavras com regra ........ ${regra.size}`);
  console.log(`  cobertura (teste) ......... ${pct(cobertos, teste.length)} dos ${teste.length} produtos de teste`);
  console.log(`  acerto onde há regra ...... ${pct(certos, cobertos)}`);
  console.log("  principais confusões:");
  for (const [k, n] of [...erros.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    ${String(n).padStart(4)}  ${k}`);

  console.log("\nPalavras mais fortes por grupo (top 3 grupos x 8 palavras):");
  for (const [g] of grupos.slice(0, 12)) {
    const ws = [...regra.entries()].filter(([, r]) => r.grupo === g).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([t]) => t);
    console.log(`  ${g.padEnd(24)} ${ws.join(", ")}`);
  }
}

async function estudoMarkup() {
  console.log("\n==================== 2. MARKUP (preço PDV / custo bruto da NF) ====================");
  const [c] = await prisma.$queryRaw<{ n: number; v: number }[]>`
    SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE preco > 0)::int AS v FROM "PrecoVariacao"`;
  console.log(`PrecoVariacao: ${c.n} linhas, ${c.v} com preço > 0.`);
  console.log("Pares = itens de NF casados com produto do PDV por referência + modelo; preço do produto = mediana dos preços das variações.");
  console.log("Custo = valor unitário (bruto) da NF.\n");

  const base = `
    WITH preco_prod AS (
      SELECT v."produtoId" AS produto_id,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY pv.preco)::float8 AS preco
      FROM "VariacaoProduto" v JOIN "PrecoVariacao" pv ON pv."variacaoId" = v.id
      WHERE pv.preco > 0 GROUP BY 1
    ),
    par AS (
      SELECT p."modeloNome" AS modelo, p."grupoNome" AS grupo,
             (pp.preco / NULLIF(i."valorUnitario", 0))::float8 AS mk
      FROM "NotaItem" i
      JOIN "Produto" p
        ON upper(trim(p."referenciaFornecedor")) = upper(trim(i."referenciaFornecedorIdentificada"))
       AND upper(trim(p."modeloNome")) = upper(trim(i."modeloIdentificado"))
      JOIN preco_prod pp ON pp.produto_id = p.id
      WHERE i."valorUnitario" > 0
        AND COALESCE(i."referenciaFornecedorIdentificada", '') <> ''
        AND COALESCE(i."modeloIdentificado", '') <> ''
    )`;
  const sel = (chave: string, minN: number, limite: number) => `${base}
    SELECT ${chave} AS chave, COUNT(*)::int AS n,
           percentile_cont(0.25) WITHIN GROUP (ORDER BY mk) AS p25,
           percentile_cont(0.5)  WITHIN GROUP (ORDER BY mk) AS med,
           percentile_cont(0.75) WITHIN GROUP (ORDER BY mk) AS p75
    FROM par GROUP BY 1 HAVING COUNT(*) >= ${minN}
    ORDER BY COUNT(*) DESC LIMIT ${limite}`;
  type L = { chave: string; n: number; p25: number; med: number; p75: number };
  const fmt = (r: L) => {
    const disp = r.med ? (r.p75 - r.p25) / r.med : 0; // dispersão relativa (IQR/mediana)
    const nivel = disp <= 0.08 ? "ESTÁVEL" : disp <= 0.2 ? "médio" : "VARIA";
    return `${r.chave.slice(0, 44).padEnd(44)} n=${String(r.n).padStart(5)}  mediana=${r.med.toFixed(2).padStart(6)}  p25=${r.p25.toFixed(2).padStart(6)}  p75=${r.p75.toFixed(2).padStart(6)}  ${nivel}`;
  };

  const porModelo = await prisma.$queryRawUnsafe<L[]>(sel("modelo", 5, 40));
  console.log("Por MODELO (top 40 por volume):");
  porModelo.forEach((r) => console.log("  " + fmt(r)));

  const porModeloGrupo = await prisma.$queryRawUnsafe<L[]>(sel(`modelo || ' | ' || COALESCE(grupo, '-')`, 8, 40));
  console.log("\nPor MODELO | GRUPO (top 40 por volume):");
  porModeloGrupo.forEach((r) => console.log("  " + fmt(r)));
}

async function estudoFinalPreco() {
  console.log("\n==================== 3. FINAL DO PREÇO NO PDV ====================");
  const r = await prisma.$queryRaw<{ total: number; f999: number; f499: number; f99: number }[]>`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE round(preco * 100)::bigint % 1000 = 999)::int AS f999,
           COUNT(*) FILTER (WHERE round(preco * 100)::bigint % 1000 = 499)::int AS f499,
           COUNT(*) FILTER (WHERE round(preco * 100)::bigint % 100 = 99)::int  AS f99
    FROM "PrecoVariacao" WHERE preco > 0`;
  const x = r[0];
  console.log(`Preços (variações) > 0: ${x.total}`);
  console.log(`  terminam em x9,99 ... ${x.f999} (${pct(x.f999, x.total)})`);
  console.log(`  terminam em x4,99 ... ${x.f499} (${pct(x.f499, x.total)})`);
  console.log(`  terminam em ,99 ..... ${x.f99} (${pct(x.f99, x.total)})`);
}

async function main() {
  await estudoGrupo();
  await estudoMarkup();
  await estudoFinalPreco();
  console.log("\nFim. Nada foi gravado no banco.");
}

main()
  .catch((e) => {
    console.error("Falhou:", String(e?.message ?? e).slice(0, 400));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
