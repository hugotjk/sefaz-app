import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { EMPRESAS_BANIDAS } from "@/lib/identificar-produto";

// Mesma paginação por MODELO da Conferência de Produtos Sem Cadastro.
export const CONFERENCIA_SEM_EAN_MODELOS_POR_PAGINA = 25;

export interface FiltrosConferenciaSemEan {
  emitente: string; // texto livre (contains, case-insensitive)
  dataInicial: string; // YYYY-MM-DD ou ""
  dataFinal: string; // YYYY-MM-DD ou ""
  pagina: number;
}

// Um produto (modelo + referência do fornecedor) que JÁ existe no sistema, mas
// cujo(s) EAN(s) da nota não existem em nenhuma variação do sistema.
export interface ProdutoSemEan {
  chave: string; // JSON([modelo, referencia])
  referencia: string | null;
  descricao: string; // do item mais recente
  emitenteNome: string | null;
  nNotas: number;
  // EANs que vieram na nota e não existem no sistema
  eansNota: string[];
  // quantas variações do(s) produto(s) do sistema têm EAN preenchido / total
  variacoesComEan: number;
  variacoesTotal: number;
}

export interface GrupoModeloSemEan {
  modelo: string | null;
  produtos: ProdutoSemEan[];
}

export interface ResultadoConferenciaSemEan {
  grupos: GrupoModeloSemEan[];
  totalModelos: number;
  totalProdutos: number;
  totalEans: number;
  pagina: number;
  porPagina: number;
  // Produtos que bateriam, mas o sistema ainda tem variações sem EAN consultado
  // (enriquecimento do catálogo em andamento) — ficam de fora da lista até o
  // PDV ser consultado, para não gerar falso positivo.
  aguardandoEnriquecimento: number;
}

export function parseFiltrosConferenciaSemEan(
  sp: URLSearchParams
): FiltrosConferenciaSemEan {
  return {
    emitente: (sp.get("emitente") ?? "").trim(),
    dataInicial: (sp.get("dataInicial") ?? "").trim(),
    dataFinal: (sp.get("dataFinal") ?? "").trim(),
    pagina: Math.max(1, parseInt(sp.get("pagina") ?? "1", 10) || 1),
  };
}

export async function montarConferenciaSemEan(
  f: FiltrosConferenciaSemEan
): Promise<ResultadoConferenciaSemEan> {
  const offsetModelos = (f.pagina - 1) * CONFERENCIA_SEM_EAN_MODELOS_POR_PAGINA;

  const gte = f.dataInicial ? new Date(`${f.dataInicial}T00:00:00.000Z`) : null;
  const lte = f.dataFinal ? new Date(`${f.dataFinal}T23:59:59.999Z`) : null;
  const filtroGte =
    gte && !Number.isNaN(gte.getTime()) ? Prisma.sql`AND n."dataEmissao" >= ${gte}` : Prisma.empty;
  const filtroLte =
    lte && !Number.isNaN(lte.getTime()) ? Prisma.sql`AND n."dataEmissao" <= ${lte}` : Prisma.empty;
  const filtroEmitente = f.emitente
    ? Prisma.sql`AND n."emitenteNome" ILIKE ${"%" + f.emitente + "%"}`
    : Prisma.empty;
  const filtroBanidos = EMPRESAS_BANIDAS.length
    ? Prisma.sql`AND (n."emitenteNome" IS NULL OR n."emitenteNome" NOT IN (${Prisma.join(
        EMPRESAS_BANIDAS
      )}))`
    : Prisma.empty;

  // Item da nota com EAN válido (8–14 dígitos) que NÃO existe em nenhuma
  // VariacaoProduto, e cujo produto (referência + modelo) EXISTE no sistema.
  // Por (modelo, referência): junta os EANs distintos da nota e olha o estado do
  // produto no sistema (variações com EAN / total / alguma ainda não consultada).
  const rows = await prisma.$queryRaw<
    {
      modelo: string;
      referencia: string;
      descricao: string;
      emitente: string | null;
      n_notas: number;
      eans: string[];
      com_ean: number;
      total: number;
      pendente: boolean;
    }[]
  >(Prisma.sql`
    WITH base AS (
      SELECT i."modeloIdentificado"               AS modelo,
             i."referenciaFornecedorIdentificada" AS referencia,
             i."descricao"                        AS descricao,
             i."ean"                              AS ean,
             i."noteId"                           AS note_id,
             n."emitenteNome"                     AS emitente,
             n."dataEmissao"                      AS data_emissao
      FROM "NotaItem" i
      JOIN "Note" n ON n.id = i."noteId"
      WHERE i."ean" ~ '^[0-9]{8,14}$'
        AND COALESCE(i."modeloIdentificado", '') <> ''
        AND COALESCE(i."referenciaFornecedorIdentificada", '') <> ''
        AND NOT EXISTS (SELECT 1 FROM "VariacaoProduto" v WHERE v."ean" = i."ean")
        ${filtroEmitente} ${filtroGte} ${filtroLte} ${filtroBanidos}
    ),
    chaves AS (
      SELECT DISTINCT upper(trim(modelo)) AS mod_u, upper(trim(referencia)) AS ref_u FROM base
    ),
    prod AS (
      SELECT c.mod_u, c.ref_u, p.id AS produto_id
      FROM chaves c
      JOIN "Produto" p
        ON upper(trim(p."referenciaFornecedor")) = c.ref_u
       AND upper(trim(p."modeloNome")) = c.mod_u
    ),
    estado AS (
      SELECT pr.mod_u, pr.ref_u,
             COUNT(v.id)::int                                          AS total,
             COUNT(*) FILTER (WHERE v."ean" IS NOT NULL AND v."ean" <> '')::int AS com_ean,
             COALESCE(bool_or(v."ean" IS NULL), false)                 AS pendente
      FROM prod pr
      LEFT JOIN "VariacaoProduto" v ON v."produtoId" = pr.produto_id
      GROUP BY pr.mod_u, pr.ref_u
    ),
    ultimo AS (
      SELECT DISTINCT ON (upper(trim(modelo)), upper(trim(referencia)))
             modelo, referencia, descricao, emitente
      FROM base
      ORDER BY upper(trim(modelo)), upper(trim(referencia)),
               data_emissao DESC NULLS LAST, note_id DESC
    ),
    agg AS (
      SELECT upper(trim(modelo)) AS mod_u, upper(trim(referencia)) AS ref_u,
             COUNT(DISTINCT note_id)::int AS n_notas,
             array_agg(DISTINCT ean)      AS eans
      FROM base
      GROUP BY 1, 2
    )
    SELECT u.modelo, u.referencia, u.descricao, u.emitente,
           a.n_notas, a.eans, e.com_ean, e.total, e.pendente
    FROM ultimo u
    JOIN agg a    ON a.mod_u = upper(trim(u.modelo)) AND a.ref_u = upper(trim(u.referencia))
    JOIN estado e ON e.mod_u = a.mod_u AND e.ref_u = a.ref_u
    ORDER BY lower(u.modelo) ASC, lower(u.referencia) ASC
  `);

  const aguardandoEnriquecimento = rows.filter((r) => r.pendente).length;
  const prontos = rows.filter((r) => !r.pendente);

  const porModelo = new Map<string, GrupoModeloSemEan>();
  let totalEans = 0;
  for (const r of prontos) {
    let g = porModelo.get(r.modelo);
    if (!g) {
      g = { modelo: r.modelo, produtos: [] };
      porModelo.set(r.modelo, g);
    }
    totalEans += r.eans.length;
    g.produtos.push({
      chave: JSON.stringify([r.modelo, r.referencia]),
      referencia: r.referencia,
      descricao: r.descricao,
      emitenteNome: r.emitente,
      nNotas: Number(r.n_notas),
      eansNota: r.eans,
      variacoesComEan: Number(r.com_ean),
      variacoesTotal: Number(r.total),
    });
  }

  // Mais produtos primeiro (igual ao relatório de cadastro).
  const todos = [...porModelo.values()].sort(
    (a, b) =>
      b.produtos.length - a.produtos.length ||
      (a.modelo ?? "").localeCompare(b.modelo ?? "", "pt-BR")
  );

  return {
    grupos: todos.slice(offsetModelos, offsetModelos + CONFERENCIA_SEM_EAN_MODELOS_POR_PAGINA),
    totalModelos: todos.length,
    totalProdutos: prontos.length,
    totalEans,
    pagina: f.pagina,
    porPagina: CONFERENCIA_SEM_EAN_MODELOS_POR_PAGINA,
    aguardandoEnriquecimento,
  };
}
