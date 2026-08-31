import { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * Relatório "Movimentação Resumida".
 *
 * Cada linha = 1 PRODUTO (todas as variações somadas). Mostra venda total e
 * estoque atual do produto, e um bloco Venda/Estoque por Loja ou por Grupo Loja.
 *
 * Tudo sai do nosso banco (nada de API do PDV ao vivo). As agregações pesadas
 * são feitas em SQL cru (CTEs + groupBy); só a montagem das colunas por loja
 * e a regra "NAOUSAR" acontecem em JS.
 */

export type Ordenacao = "venda" | "estoque";
export type VerPor = "loja" | "grupoLoja";
export type CampoProduto = "fornecedor" | "modelo";
export type ListarPor = "referencia" | "referenciaFornecedor";

export interface FiltrosRelatorio {
  ordenacao: Ordenacao;
  verPor: VerPor;
  dataInicial: string; // YYYY-MM-DD
  dataFinal: string; // YYYY-MM-DD
  redeId: number | null;
  tipoLojaId: number | null; // EmpresaLoja.codigo -> FilialSync.empresaId
  grupoLojaId: number | null; // GrupoLoja.codigo   -> FilialSync.grupoId
  campoProduto: CampoProduto;
  fornecedorNome: string | null;
  modeloNome: string | null;
  subGrupo: string | null; // Produto.compradorNome
  colecao: string | null; // Produto.colecaoNome
  grupoProduto: string | null; // Produto.grupoNome
  listarPor: ListarPor;
  pagina: number; // 1-based
  tamanhoPagina: number;
}

export interface ColunaRelatorio {
  key: string;
  nome: string;
}

export interface ProdutoRelatorio {
  id: string;
  referencia: string;
  referenciaFornecedor: string | null;
  descricao: string | null;
  redeId: number;
  grupoNome: string | null;
  colecaoNome: string | null;
  modeloNome: string | null;
  fornecedorNome: string | null;
  compradorNome: string | null;
  precoVarejo: number | null;
  vendaValor: number;
  vendaQtd: number;
  estoque: number;
  colunas: { venda: number; estoque: number }[]; // alinhado a `colunas` do resultado
}

export interface OpcoesRelatorio {
  redes: { valor: string; label: string }[];
  tiposLoja: { valor: string; label: string }[];
  gruposLoja: { valor: string; label: string }[];
  modelos: string[];
  fornecedores: string[];
  subGrupos: string[];
  colecoes: string[];
  gruposProduto: string[];
}

export interface RelatorioResultado {
  total: number;
  pagina: number;
  tamanhoPagina: number;
  colunas: ColunaRelatorio[];
  produtos: ProdutoRelatorio[];
  opcoes: OpcoesRelatorio;
  aviso?: string;
}

// --------------------------------------------------------------------------

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

function limitesData(dataInicial: string, dataFinal: string) {
  const ini = new Date(`${dataInicial}T00:00:00.000Z`);
  const fimExcl = new Date(`${dataFinal}T00:00:00.000Z`);
  fimExcl.setUTCDate(fimExcl.getUTCDate() + 1); // fim inclusivo -> < dia seguinte
  return { ini, fimExcl, iniMes: dataInicial.slice(0, 7), fimMes: dataFinal.slice(0, 7) };
}

/** Fragmento `AND "lojaId" IN (...)` ou vazio. */
function filtroLoja(coluna: string, lojaIds: number[] | null): Prisma.Sql {
  if (!lojaIds || lojaIds.length === 0) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.raw(`"${coluna}"`)} IN (${Prisma.join(lojaIds)})`;
}

export class RelatorioTimeoutError extends Error {
  constructor() {
    super("A consulta demorou demais. Restrinja os filtros (período menor, uma rede ou loja específica) e tente novamente.");
    this.name = "RelatorioTimeoutError";
  }
}

const STATEMENT_TIMEOUT_MS = 10_000;

function ehTimeout(err: unknown): boolean {
  const e = err as any;
  const msg = String(e?.message ?? err).toLowerCase();
  // Prisma embrulha o erro do Postgres como P2010; o código real (57014) e o
  // texto de cancelamento aparecem na mensagem.
  return (
    e?.code === "57014" ||
    msg.includes("57014") ||
    msg.includes("statement timeout") ||
    msg.includes("canceling statement due to")
  );
}

/**
 * Roda a query pesada com `statement_timeout` LOCAL (via set_config numa
 * transação): se passar de STATEMENT_TIMEOUT_MS o Postgres cancela e a gente
 * devolve um erro tratado em vez de segurar a conexão.
 */
async function queryComTimeout<T>(sql: Prisma.Sql): Promise<T> {
  try {
    const [, rows] = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`,
      prisma.$queryRaw<T>(sql),
    ]);
    return rows as T;
  } catch (err) {
    if (ehTimeout(err)) throw new RelatorioTimeoutError();
    throw err;
  }
}

function whereProduto(f: FiltrosRelatorio): Prisma.Sql {
  const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (f.redeId != null) conds.push(Prisma.sql`p."redeId" = ${f.redeId}`);
  if (f.colecao) conds.push(Prisma.sql`p."colecaoNome" = ${f.colecao}`);
  if (f.grupoProduto) conds.push(Prisma.sql`p."grupoNome" = ${f.grupoProduto}`);
  if (f.subGrupo) conds.push(Prisma.sql`p."compradorNome" = ${f.subGrupo}`);
  if (f.campoProduto === "modelo" && f.modeloNome)
    conds.push(Prisma.sql`p."modeloNome" = ${f.modeloNome}`);
  if (f.campoProduto === "fornecedor" && f.fornecedorNome)
    conds.push(Prisma.sql`p."fornecedorNome" = ${f.fornecedorNome}`);
  return Prisma.join(conds, " AND ");
}

// --------------------------------------------------------------------------

interface LinhaProdutoRaw {
  id: string;
  nome: string | null;
  referenciaFornecedor: string | null;
  redeId: number;
  grupoNome: string | null;
  colecaoNome: string | null;
  compradorNome: string | null;
  modeloNome: string | null;
  fornecedorNome: string | null;
  venda_val: number;
  venda_qtd: number;
  estoque_qtd: number;
  preco: number | null;
  total_rows: number | bigint;
}

export async function montarRelatorio(f: FiltrosRelatorio): Promise<RelatorioResultado> {
  const { ini, fimExcl, iniMes, fimMes } = limitesData(f.dataInicial, f.dataFinal);

  // ---- 1. Lojas em escopo (filtro Tipo Loja / Grupo Loja) + regra NAOUSAR ----
  const [filiais, empresas, grupos, redes] = await Promise.all([
    prisma.filialSync.findMany(),
    prisma.empresaLoja.findMany(),
    prisma.grupoLoja.findMany(),
    prisma.redeSync.findMany(),
  ]);

  const nomeEmpresa = new Map(empresas.map((e) => [e.codigo, e.nome]));
  const nomeGrupoLoja = new Map(grupos.map((g) => [g.codigo, g.nome]));
  const nomeRede = new Map(redes.map((r) => [r.id, r.nome]));

  const nomesFiliais = new Set(
    filiais.map((x) => (x.nome ?? "").trim()).filter(Boolean).map((n) => n.toUpperCase())
  );
  const canonNome = (raw: string | null): string => {
    const nome = (raw ?? "").trim();
    const m = nome.match(/^(.*?)[\s]*NAOUSAR[\s]*$/i);
    if (m && nomesFiliais.has(m[1].trim().toUpperCase())) return m[1].trim();
    return nome || "(sem nome)";
  };

  // lojaId -> info consolidada (já com NAOUSAR unificado)
  const lojaInfo = new Map<
    number,
    { chaveLoja: string; nomeLoja: string; empresaId: number | null; grupoId: number | null }
  >();
  // canonNome -> empresaId/grupoId da filial "principal" (sem sufixo)
  const principalPorCanon = new Map<string, { empresaId: number | null; grupoId: number | null }>();
  for (const fil of filiais) {
    const canon = canonNome(fil.nome);
    if ((fil.nome ?? "").trim().toUpperCase() === canon.toUpperCase() || !principalPorCanon.has(canon)) {
      principalPorCanon.set(canon, { empresaId: fil.empresaId, grupoId: fil.grupoId });
    }
  }
  for (const fil of filiais) {
    const canon = canonNome(fil.nome);
    const principal = principalPorCanon.get(canon) ?? { empresaId: fil.empresaId, grupoId: fil.grupoId };
    lojaInfo.set(fil.lojaId, {
      chaveLoja: canon.toUpperCase(),
      nomeLoja: canon,
      empresaId: principal.empresaId,
      grupoId: principal.grupoId,
    });
  }

  let lojaIdsEscopo: number[] | null = null;
  if (f.tipoLojaId != null || f.grupoLojaId != null) {
    lojaIdsEscopo = filiais
      .filter(
        (fil) =>
          (f.tipoLojaId == null || fil.empresaId === f.tipoLojaId) &&
          (f.grupoLojaId == null || fil.grupoId === f.grupoLojaId)
      )
      .map((fil) => fil.lojaId);
    if (lojaIdsEscopo.length === 0) lojaIdsEscopo = [-1]; // nada bate -> resultado vazio
  }

  const fLojaVI = filtroLoja("lojaId", lojaIdsEscopo);
  const fLojaVR = filtroLoja("lojaId", lojaIdsEscopo);
  const fLojaEst = lojaIdsEscopo
    ? Prisma.sql`WHERE e."lojaId" IN (${Prisma.join(lojaIdsEscopo)})`
    : Prisma.empty;

  // ---- 2. Página de produtos + totais (uma query, total via COUNT() OVER()) ----
  const orderBy =
    f.ordenacao === "venda"
      ? Prisma.sql`(CASE WHEN COALESCE(vend.val,0) <> 0 THEN 0 ELSE 1 END), COALESCE(vend.val,0) DESC, COALESCE(est.qtd,0) DESC, p.id`
      : Prisma.sql`(CASE WHEN COALESCE(est.qtd,0) <> 0 THEN 0 ELSE 1 END), COALESCE(est.qtd,0) DESC, COALESCE(vend.val,0) DESC, p.id`;

  const offset = Math.max(0, (f.pagina - 1) * f.tamanhoPagina);

  const linhas = await queryComTimeout<LinhaProdutoRaw[]>(Prisma.sql`
    WITH vend AS (
      SELECT vp."produtoId" AS pid, SUM(x.qtd) AS qtd, SUM(x.val) AS val
      FROM (
        SELECT vi."variacaoId" AS vid, vi.quantidade AS qtd, vi.valor AS val
        FROM "VendaItemSync" vi
        WHERE vi."dataHora" >= ${ini} AND vi."dataHora" < ${fimExcl} ${fLojaVI}
        UNION ALL
        SELECT vr."variacaoId", vr."quantidadeTotal", vr."valorTotal"
        FROM "VendaResumoMensal" vr
        WHERE vr."anoMes" >= ${iniMes} AND vr."anoMes" <= ${fimMes} ${fLojaVR}
      ) x
      JOIN "VariacaoProduto" vp ON vp.id = x.vid
      GROUP BY vp."produtoId"
    ),
    est AS (
      SELECT vp."produtoId" AS pid, SUM(e.quantidade) AS qtd
      FROM "EstoqueVariacaoSync" e
      JOIN "VariacaoProduto" vp ON vp.id = e."variacaoId"
      ${fLojaEst}
      GROUP BY vp."produtoId"
    ),
    prc AS (
      SELECT vp."produtoId" AS pid, AVG(pr.preco) AS preco
      FROM "PrecoVariacao" pr
      JOIN "VariacaoProduto" vp ON vp.id = pr."variacaoId"
      GROUP BY vp."produtoId"
    )
    SELECT p.id, p.nome, p."referenciaFornecedor", p."redeId",
           p."grupoNome", p."colecaoNome", p."compradorNome", p."modeloNome", p."fornecedorNome",
           COALESCE(vend.val,0)::float8 AS venda_val,
           COALESCE(vend.qtd,0)::float8 AS venda_qtd,
           COALESCE(est.qtd,0)::float8  AS estoque_qtd,
           prc.preco::float8 AS preco,
           COUNT(*) OVER() AS total_rows
    FROM "Produto" p
    LEFT JOIN vend ON vend.pid = p.id
    LEFT JOIN est  ON est.pid  = p.id
    LEFT JOIN prc  ON prc.pid  = p.id
    WHERE ${whereProduto(f)}
      AND (COALESCE(vend.val,0) <> 0 OR COALESCE(est.qtd,0) <> 0)
    ORDER BY ${orderBy}
    LIMIT ${f.tamanhoPagina} OFFSET ${offset}
  `);

  const total = linhas.length ? Number(linhas[0].total_rows) : 0;
  const pageIds = linhas.map((l) => l.id);

  // ---- 3. Breakdown por (produto, loja): vendas e estoque ----
  const vendasPorLoja = pageIds.length
    ? await queryComTimeout<{ pid: string; loja: number; val: number; qtd: number }[]>(Prisma.sql`
        SELECT vp."produtoId" AS pid, x.loja AS loja,
               SUM(x.val)::float8 AS val, SUM(x.qtd)::float8 AS qtd
        FROM (
          SELECT vi."variacaoId" AS vid, vi."lojaId" AS loja, vi.quantidade AS qtd, vi.valor AS val
          FROM "VendaItemSync" vi
          WHERE vi."dataHora" >= ${ini} AND vi."dataHora" < ${fimExcl} ${fLojaVI}
          UNION ALL
          SELECT vr."variacaoId", vr."lojaId", vr."quantidadeTotal", vr."valorTotal"
          FROM "VendaResumoMensal" vr
          WHERE vr."anoMes" >= ${iniMes} AND vr."anoMes" <= ${fimMes} ${fLojaVR}
        ) x
        JOIN "VariacaoProduto" vp ON vp.id = x.vid
        WHERE vp."produtoId" IN (${Prisma.join(pageIds)})
        GROUP BY vp."produtoId", x.loja
      `)
    : [];

  const estoquePorLoja = pageIds.length
    ? await queryComTimeout<{ pid: string; loja: number; qtd: number }[]>(Prisma.sql`
        SELECT vp."produtoId" AS pid, e."lojaId" AS loja, SUM(e.quantidade)::float8 AS qtd
        FROM "EstoqueVariacaoSync" e
        JOIN "VariacaoProduto" vp ON vp.id = e."variacaoId"
        WHERE vp."produtoId" IN (${Prisma.join(pageIds)})
          ${lojaIdsEscopo ? Prisma.sql`AND e."lojaId" IN (${Prisma.join(lojaIdsEscopo)})` : Prisma.empty}
        GROUP BY vp."produtoId", e."lojaId"
      `)
    : [];

  // ---- 4. Consolidar colunas (Loja ou Grupo Loja) ----
  function colunaDe(lojaId: number): { key: string; nome: string } | null {
    const info = lojaInfo.get(lojaId);
    if (f.verPor === "grupoLoja") {
      const gid = info?.grupoId ?? null;
      if (gid == null) return { key: "g:sem", nome: "(sem grupo loja)" };
      return { key: `g:${gid}`, nome: nomeGrupoLoja.get(gid) ?? `Grupo ${gid}` };
    }
    if (!info) return { key: `l:${lojaId}`, nome: `Loja ${lojaId}` };
    return { key: `l:${info.chaveLoja}`, nome: info.nomeLoja };
  }

  const colunasMap = new Map<string, string>(); // key -> nome
  // pid -> colKey -> { venda, estoque }
  const celulas = new Map<string, Map<string, { venda: number; estoque: number }>>();
  const bump = (pid: string, col: { key: string; nome: string }, venda: number, estoque: number) => {
    colunasMap.set(col.key, col.nome);
    let m = celulas.get(pid);
    if (!m) celulas.set(pid, (m = new Map()));
    const c = m.get(col.key) ?? { venda: 0, estoque: 0 };
    c.venda += venda;
    c.estoque += estoque;
    m.set(col.key, c);
  };
  for (const r of vendasPorLoja) {
    const col = colunaDe(r.loja);
    if (col) bump(r.pid, col, num(r.val), 0);
  }
  for (const r of estoquePorLoja) {
    const col = colunaDe(r.loja);
    if (col) bump(r.pid, col, 0, num(r.qtd));
  }

  // Só colunas com algum valor; ordenadas por nome.
  const colunas: ColunaRelatorio[] = [...colunasMap.entries()]
    .map(([key, nome]) => ({ key, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const produtos: ProdutoRelatorio[] = linhas.map((l) => {
    const m = celulas.get(l.id);
    return {
      id: l.id,
      referencia: l.id,
      referenciaFornecedor: l.referenciaFornecedor,
      descricao: l.nome,
      redeId: l.redeId,
      grupoNome: l.grupoNome,
      colecaoNome: l.colecaoNome,
      modeloNome: l.modeloNome,
      fornecedorNome: l.fornecedorNome,
      compradorNome: l.compradorNome,
      precoVarejo: l.preco == null ? null : num(l.preco),
      vendaValor: num(l.venda_val),
      vendaQtd: num(l.venda_qtd),
      estoque: num(l.estoque_qtd),
      colunas: colunas.map((c) => m?.get(c.key) ?? { venda: 0, estoque: 0 }),
    };
  });

  // ---- 5. Opções dos filtros (com regra de prioridade venda/estoque) ----
  const opcoes = await montarOpcoes(
    f,
    { ini, fimExcl, iniMes, fimMes },
    nomeEmpresa,
    nomeGrupoLoja,
    nomeRede
  );

  const aviso =
    filiais.length === 0
      ? "Sincronização de filiais ainda não rodou — colunas por loja podem aparecer como 'Loja {id}'."
      : total === 0
      ? "Nenhum produto com venda/estoque para os filtros (ou o catálogo ainda está sincronizando)."
      : undefined;

  return { total, pagina: f.pagina, tamanhoPagina: f.tamanhoPagina, colunas, produtos, opcoes, aviso };
}

// --------------------------------------------------------------------------

interface OpcaoBucketRow {
  campo: string;
  val: string;
  tv: boolean;
  te: boolean;
}

async function montarOpcoes(
  f: FiltrosRelatorio,
  d: { ini: Date; fimExcl: Date; iniMes: string; fimMes: string },
  nomeEmpresa: Map<number, string>,
  nomeGrupoLoja: Map<number, string>,
  nomeRede: Map<number, string>
): Promise<OpcoesRelatorio> {
  // Uma query só: para cada campo de produto, quais valores aparecem entre
  // produtos VENDIDOS no período ('v') e entre produtos com ESTOQUE ('e').
  // Rede/Tipo Loja/Grupo Loja NÃO entram aqui — vêm de tabelas próprias e
  // completas (ver `return` abaixo).
  const camposProduto = Prisma.sql`
    ('colecao', p."colecaoNome"), ('grupo', p."grupoNome"),
    ('subgrupo', p."compradorNome"), ('modelo', p."modeloNome"), ('fornecedor', p."fornecedorNome")
  `;

  let rows: OpcaoBucketRow[] = [];
  try {
    rows = await queryComTimeout<OpcaoBucketRow[]>(Prisma.sql`
      SELECT s.campo, s.val, bool_or(s.origem = 'v') AS tv, bool_or(s.origem = 'e') AS te
      FROM (
        SELECT c.campo, c.val, 'v'::text AS origem
        FROM "VendaItemSync" vi
        JOIN "VariacaoProduto" vp ON vp.id = vi."variacaoId"
        JOIN "Produto" p ON p.id = vp."produtoId"
        CROSS JOIN LATERAL (VALUES ${camposProduto}) c(campo, val)
        WHERE vi."dataHora" >= ${d.ini} AND vi."dataHora" < ${d.fimExcl}
          AND c.val IS NOT NULL AND c.val <> ''
        UNION ALL
        SELECT c.campo, c.val, 'v'
        FROM "VendaResumoMensal" vr
        JOIN "VariacaoProduto" vp ON vp.id = vr."variacaoId"
        JOIN "Produto" p ON p.id = vp."produtoId"
        CROSS JOIN LATERAL (VALUES ${camposProduto}) c(campo, val)
        WHERE vr."anoMes" >= ${d.iniMes} AND vr."anoMes" <= ${d.fimMes}
          AND c.val IS NOT NULL AND c.val <> ''
        UNION ALL
        SELECT c.campo, c.val, 'e'
        FROM "EstoqueVariacaoSync" e
        JOIN "VariacaoProduto" vp ON vp.id = e."variacaoId"
        JOIN "Produto" p ON p.id = vp."produtoId"
        CROSS JOIN LATERAL (VALUES ${camposProduto}) c(campo, val)
        WHERE e.quantidade <> 0 AND c.val IS NOT NULL AND c.val <> ''
      ) s
      GROUP BY s.campo, s.val
    `);
  } catch {
    rows = [];
  }

  const prioriza = (lista: OpcaoBucketRow[]): string[] => {
    const primeiro = f.ordenacao === "venda" ? (r: OpcaoBucketRow) => r.tv : (r: OpcaoBucketRow) => r.te;
    const a = lista.filter(primeiro).map((r) => r.val);
    const b = lista.filter((r) => !primeiro(r)).map((r) => r.val);
    const vistos = new Set<string>();
    const out: string[] = [];
    for (const v of [...a.sort((x, y) => x.localeCompare(y, "pt-BR")), ...b.sort((x, y) => x.localeCompare(y, "pt-BR"))]) {
      if (!vistos.has(v)) {
        vistos.add(v);
        out.push(v);
      }
    }
    return out;
  };
  const doCampo = (nome: string) => prioriza(rows.filter((r) => r.campo === nome));

  // Rede / Tipo Loja / Grupo Loja: vêm INTEIRAS das tabelas RedeSync /
  // EmpresaLoja / GrupoLoja — não dependem do catálogo de produtos já
  // sincronizado. Só ordenamos por nome.
  const listaTabela = (m: Map<number, string>) =>
    [...m.entries()]
      .map(([codigo, nome]) => ({ valor: String(codigo), label: nome }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  return {
    redes: listaTabela(nomeRede),
    tiposLoja: listaTabela(nomeEmpresa),
    gruposLoja: listaTabela(nomeGrupoLoja),
    modelos: doCampo("modelo"),
    fornecedores: doCampo("fornecedor"),
    subGrupos: doCampo("subgrupo"),
    colecoes: doCampo("colecao"),
    gruposProduto: doCampo("grupo"),
  };
}

// --------------------------------------------------------------------------

const HOJE = () => new Date().toISOString().slice(0, 10);

export function parseFiltros(sp: URLSearchParams): FiltrosRelatorio {
  const s = (k: string) => sp.get(k)?.trim() || null;
  const dataFinal = s("dataFinal") ?? HOJE();
  const dataInicial =
    s("dataInicial") ??
    (() => {
      const d = new Date(`${dataFinal}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - 30);
      return d.toISOString().slice(0, 10);
    })();

  const tamanhoPagina = Math.min(200, Math.max(10, parseInt(sp.get("tamanhoPagina") ?? "50", 10) || 50));
  const pagina = Math.max(1, parseInt(sp.get("pagina") ?? "1", 10) || 1);

  return {
    ordenacao: s("ordenacao") === "estoque" ? "estoque" : "venda",
    verPor: s("verPor") === "grupoLoja" ? "grupoLoja" : "loja",
    dataInicial,
    dataFinal,
    redeId: s("redeId") ? Number(s("redeId")) : null,
    tipoLojaId: s("tipoLojaId") ? Number(s("tipoLojaId")) : null,
    grupoLojaId: s("grupoLojaId") ? Number(s("grupoLojaId")) : null,
    campoProduto: s("campoProduto") === "modelo" ? "modelo" : "fornecedor",
    fornecedorNome: s("fornecedorNome"),
    modeloNome: s("modeloNome"),
    subGrupo: s("subGrupo"),
    colecao: s("colecao"),
    grupoProduto: s("grupoProduto"),
    listarPor: s("listarPor") === "referenciaFornecedor" ? "referenciaFornecedor" : "referencia",
    pagina,
    tamanhoPagina,
  };
}
