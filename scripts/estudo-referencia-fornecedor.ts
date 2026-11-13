/**
 * ESTUDO SOMENTE-LEITURA (não grava nada): descobre o padrão de REFERÊNCIA e de MODELO de fornecedores
 * que ainda não têm regra. Cruza os itens das notas (NotaItem) com o catálogo do PDV pelo EAN
 * (VariacaoProduto.ean -> Produto) e testa regras candidatas "código da nota -> referência do catálogo".
 *
 *   npx tsx --env-file=.env scripts/estudo-referencia-fornecedor.ts
 *   npx tsx --env-file=.env scripts/estudo-referencia-fornecedor.ts "NOME DO EMITENTE"   (outro fornecedor)
 *
 * Cole o resultado de volta no chat.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ALVOS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "RADU INDUSTRIA IMPORTACAO E EXPORTACAO LTDA",
      "CHP BRANDS BRASIL LTDA",
      "XERYUS IMP. DISTRIB. DE ARTIGOS P/ VESTUARIO LTDA",
    ];

const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

type Par = { cod: string; desc: string; ean: string; ref: string; modelo: string };

// Regras candidatas: (código da nota, descrição) -> referência
const regras: { nome: string; f: (c: string, d: string) => string }[] = [
  { nome: "código puro", f: (c) => c },
  { nome: "sem pontos", f: (c) => c.replace(/\./g, "") },
  { nome: "sem hífens", f: (c) => c.replace(/-/g, "") },
  { nome: "hífen -> _", f: (c) => c.replace(/\s*-\s*/g, "_") },
  { nome: "sem espaços", f: (c) => c.replace(/\s+/g, "") },
  { nome: "só letras/números", f: (c) => c.replace(/[^A-Za-z0-9]/g, "") },
  { nome: "antes do 1º ponto", f: (c) => c.split(".")[0] },
  { nome: "antes do 1º hífen", f: (c) => c.split("-")[0] },
  { nome: "antes do 1º espaço", f: (c) => c.split(/\s+/)[0] },
  { nome: "antes do 1º _", f: (c) => c.split("_")[0] },
  { nome: "antes do último ponto", f: (c) => (c.includes(".") ? c.slice(0, c.lastIndexOf(".")) : c) },
  { nome: "antes do último hífen", f: (c) => (c.includes("-") ? c.slice(0, c.lastIndexOf("-")) : c) },
  { nome: "depois do 1º hífen", f: (c) => (c.includes("-") ? c.slice(c.indexOf("-") + 1) : c) },
  { nome: "depois do 1º ponto", f: (c) => (c.includes(".") ? c.slice(c.indexOf(".") + 1) : c) },
  ...[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((n) => ({ nome: `primeiros ${n}`, f: (c: string) => c.slice(0, n) })),
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ nome: `menos os ${n} últimos`, f: (c: string) => c.slice(0, Math.max(0, c.length - n)) })),
  ...[1, 2, 3].map((n) => ({ nome: `sem os ${n} primeiros`, f: (c: string) => c.slice(n) })),
];

async function estudar(alvo: string) {
  console.log(`\n\n==================== ${alvo} ====================`);
  const tot = await prisma.$queryRaw<{ n: bigint; comEan: bigint; tem: bigint }[]>`
    SELECT count(*) AS n, count(*) FILTER (WHERE ni.ean IS NOT NULL AND ni.ean <> '') AS "comEan",
           count(*) FILTER (WHERE ni."temCadastro") AS tem
    FROM "NotaItem" ni JOIN "Note" n ON n.id = ni."noteId" WHERE n."emitenteNome" ILIKE ${alvo + "%"}`;
  console.log(`Itens de nota: ${tot[0]?.n ?? 0} | com EAN: ${tot[0]?.comEan ?? 0} | já com cadastro: ${tot[0]?.tem ?? 0}`);

  const pares = await prisma.$queryRaw<Par[]>`
    SELECT DISTINCT ni."codigoProduto" AS cod, ni.descricao AS desc, ni.ean, p."referenciaFornecedor" AS ref, p."modeloNome" AS modelo
    FROM "NotaItem" ni
    JOIN "Note" n ON n.id = ni."noteId"
    JOIN "VariacaoProduto" v ON v.ean = ni.ean
    JOIN "Produto" p ON p.id = v."produtoId"
    WHERE n."emitenteNome" ILIKE ${alvo + "%"} AND ni.ean IS NOT NULL AND ni.ean <> '' AND p."referenciaFornecedor" IS NOT NULL
    LIMIT 5000`;
  console.log(`Pares (item da nota <-> produto do catálogo, casados pelo EAN): ${pares.length}`);

  const semMatch = await prisma.$queryRaw<{ cod: string; desc: string }[]>`
    SELECT DISTINCT ni."codigoProduto" AS cod, ni.descricao AS desc
    FROM "NotaItem" ni JOIN "Note" n ON n.id = ni."noteId"
    WHERE n."emitenteNome" ILIKE ${alvo + "%"} AND ni."temCadastro" = false LIMIT 12`;
  if (semMatch.length) {
    console.log("\nItens SEM cadastro hoje (amostra: código | descrição):");
    for (const s of semMatch) console.log(`  ${s.cod} | ${s.desc}`);
  }
  if (pares.length === 0) {
    console.log("Sem pares para estudar (nenhum EAN desses itens está no catálogo).");
    return;
  }

  console.log("\nAmostra de pares (código da nota | referência no catálogo | modelo no catálogo):");
  const vistos = new Set<string>();
  for (const p of pares) {
    const k = `${p.cod}|${p.ref}|${p.modelo}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    if (vistos.size > 25) break;
    console.log(`  ${p.cod} | ${p.ref} | ${p.modelo}`);
  }

  // Acerto de cada regra candidata (mesma comparação do app: trim + maiúsculas)
  const unicos: Par[] = [...new Map<string, Par>(pares.map((p): [string, Par] => [`${p.cod}|${p.ref}`, p])).values()];
  const placar = regras
    .map((r) => ({ nome: r.nome, acertos: unicos.filter((p) => norm(r.f(p.cod, p.desc)) === norm(p.ref)).length }))
    .sort((a, b) => b.acertos - a.acertos);
  console.log(`\nRegras testadas (de ${unicos.length} pares código->referência distintos):`);
  for (const r of placar.slice(0, 8)) console.log(`  ${String(r.acertos).padStart(5)}  ${pct(r.acertos, unicos.length).padStart(6)}  ${r.nome}`);

  const melhor = regras.find((r) => r.nome === placar[0].nome)!;
  const erros = unicos.filter((p) => norm(melhor.f(p.cod, p.desc)) !== norm(p.ref));
  if (erros.length) {
    console.log(`\nOnde a melhor regra ("${melhor.nome}") ERRA (código | gerado | catálogo):`);
    for (const p of erros.slice(0, 15)) console.log(`  ${p.cod} | ${melhor.f(p.cod, p.desc)} | ${p.ref}`);
  }

  // Relação de tamanho código x referência (sufixo/prefixo)
  const cont = (f: (p: Par) => boolean) => unicos.filter(f).length;
  console.log(`\nReferência do catálogo é PREFIXO do código: ${cont((p) => norm(p.cod).startsWith(norm(p.ref)))} | código é prefixo da ref: ${cont((p) => norm(p.ref).startsWith(norm(p.cod)))} | ref contida no código: ${cont((p) => norm(p.cod).includes(norm(p.ref)))}`);

  // Modelo
  const porModelo = new Map<string, number>();
  for (const p of pares) porModelo.set(p.modelo ?? "(vazio)", (porModelo.get(p.modelo ?? "(vazio)") ?? 0) + 1);
  console.log("\nModelo no catálogo (contagem de pares):");
  for (const [m, n] of [...porModelo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(n).padStart(5)}  ${m}`);

  // Palavras da descrição x modelo (para achar o que decide o modelo)
  const palavras = ["FLAMENGO", "FLA", "CRF", "FLUMINENSE", "FLU", "VASCO", "BOTAFOGO", "BRASIL", "MASC", "FEM", "INF", "INFANTIL", "FEMININO", "MASCULINO"];
  console.log("\nPalavra na descrição -> modelo no catálogo:");
  for (const w of palavras) {
    const re = new RegExp(`(^|[^A-Z])${w}([^A-Z]|$)`);
    const grupo = pares.filter((p) => re.test(semAcento(norm(p.desc))));
    if (!grupo.length) continue;
    const m = new Map<string, number>();
    for (const p of grupo) m.set(p.modelo ?? "(vazio)", (m.get(p.modelo ?? "(vazio)") ?? 0) + 1);
    console.log(`  "${w}" (${grupo.length}): ` + [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ; "));
  }
}

async function main() {
  for (const a of ALVOS) await estudar(a);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
