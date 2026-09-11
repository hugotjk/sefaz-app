import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// Paginação por FORNECEDOR (accordion): cada página traz N fornecedores, cada
// um com TODAS as suas notas do período (nunca corta um fornecedor no meio
// da página) — mesmo padrão da Conferência de Produtos (paginação por Modelo).
export const CONFERENCIA_FORNECEDORES_POR_PAGINA = 20;

export interface FiltrosConferencia {
  emitente: string; // texto livre (contains, case-insensitive)
  dataInicial: string; // YYYY-MM-DD ou "" (todos os períodos)
  dataFinal: string; // YYYY-MM-DD ou ""
  pagina: number;
}

export interface NotaConferencia {
  id: string;
  dataEmissao: string | null;
  notaFiscal: string; // Note.numero cru — mesmo formato da tela de Notas Fiscais
  modelo: string;
  loja: string;
  lojaEncontrada: boolean;
  prazoPagamento: string;
  qtdPecas: number;
  valorTotal: string;
}

export interface GrupoFornecedorConferencia {
  fornecedor: string;
  notas: NotaConferencia[];
  somaPecas: number;
}

export interface ResultadoConferencia {
  grupos: GrupoFornecedorConferencia[]; // só os fornecedores da página atual
  totalFornecedores: number; // total de fornecedores (base da paginação)
  totalNotas: number; // total de notas em TODOS os fornecedores (não só a página)
  pagina: number;
  porPagina: number; // fornecedores por página
}

interface LinhaRaw {
  id: string;
  fornecedor: string | null;
  data_emissao: Date | null;
  numero: string | null;
  cnpj_destino: string;
  loja_ref: string | null;
  modelo: string | null;
  qtd_pecas: number;
  valor_total: string | null;
  prazos: string | null;
  loja_encontrada: boolean;
}

export function parseFiltrosConferencia(sp: URLSearchParams): FiltrosConferencia {
  return {
    emitente: (sp.get("emitente") ?? "").trim(),
    dataInicial: (sp.get("dataInicial") ?? "").trim(),
    dataFinal: (sp.get("dataFinal") ?? "").trim(),
    pagina: Math.max(1, parseInt(sp.get("pagina") ?? "1", 10) || 1),
  };
}

function formatarCnpj(v: string): string {
  const d = (v || "").replace(/\D/g, "").padStart(14, "0").slice(-14);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export async function montarConferenciaPrazo(
  f: FiltrosConferencia
): Promise<ResultadoConferencia> {
  const offsetFornecedores = (f.pagina - 1) * CONFERENCIA_FORNECEDORES_POR_PAGINA;

  const gte = f.dataInicial ? new Date(`${f.dataInicial}T00:00:00.000Z`) : null;
  const lte = f.dataFinal ? new Date(`${f.dataFinal}T23:59:59.999Z`) : null;
  const filtroGte = gte && !Number.isNaN(gte.getTime()) ? Prisma.sql`AND n."dataEmissao" >= ${gte}` : Prisma.empty;
  const filtroLte = lte && !Number.isNaN(lte.getTime()) ? Prisma.sql`AND n."dataEmissao" <= ${lte}` : Prisma.empty;
  const filtroEmitente = f.emitente
    ? Prisma.sql`AND n."emitenteNome" ILIKE ${"%" + f.emitente + "%"}`
    : Prisma.empty;

  // Sem LIMIT: o filtro de data (padrão 30 dias no cliente) mantém o conjunto
  // pequeno no caso comum; o agrupamento/paginação por fornecedor é feito em
  // memória (mesmo padrão da Conferência de Produtos), pra nunca cortar um
  // fornecedor no meio de uma página.
  const rows = await prisma.$queryRaw<LinhaRaw[]>(Prisma.sql`
    WITH item_agg AS (
      SELECT "noteId" AS nid,
             SUM(quantidade)::float8 AS qtd_pecas,
             mode() WITHIN GROUP (ORDER BY "modeloIdentificado") AS modelo_moda
      FROM "NotaItem"
      GROUP BY "noteId"
    ),
    dup_agg AS (
      SELECT d."noteId" AS nid,
             string_agg(
               ROUND(EXTRACT(EPOCH FROM (d.vencimento - n0."dataEmissao")) / 86400.0)::int::text,
               '/' ORDER BY d.vencimento ASC
             ) AS prazos
      FROM "NotaDuplicata" d
      JOIN "Note" n0 ON n0.id = d."noteId" AND n0."dataEmissao" IS NOT NULL
      GROUP BY d."noteId"
    )
    SELECT
      n.id,
      n."emitenteNome"          AS fornecedor,
      n."dataEmissao"           AS data_emissao,
      n.numero                  AS numero,
      n."cnpjDestino"           AS cnpj_destino,
      lr.loja                   AS loja_ref,
      NULLIF(ia.modelo_moda, '') AS modelo,
      COALESCE(ia.qtd_pecas, 0)::float8 AS qtd_pecas,
      n."valorTotal"::text      AS valor_total,
      da.prazos                 AS prazos,
      (lr.cnpj IS NOT NULL)     AS loja_encontrada
    FROM "Note" n
    LEFT JOIN item_agg ia ON ia.nid = n.id
    LEFT JOIN dup_agg  da ON da.nid = n.id
    LEFT JOIN "LojaReferencia" lr ON lr.cnpj = n."cnpjDestino"
    WHERE 1=1 ${filtroEmitente} ${filtroGte} ${filtroLte}
    ORDER BY n."dataEmissao" DESC NULLS LAST, n.id DESC
  `);

  const porFornecedor = new Map<string, GrupoFornecedorConferencia>();
  for (const r of rows) {
    const nome = r.fornecedor?.trim() || "(sem fornecedor)";
    let g = porFornecedor.get(nome);
    if (!g) {
      g = { fornecedor: nome, notas: [], somaPecas: 0 };
      porFornecedor.set(nome, g);
    }
    const qtd = Number(r.qtd_pecas ?? 0);
    g.somaPecas += qtd;
    g.notas.push({
      id: r.id,
      dataEmissao: r.data_emissao ? r.data_emissao.toISOString() : null,
      notaFiscal: r.numero?.trim() || "-",
      modelo: r.modelo?.trim() || "-",
      loja: r.loja_encontrada ? r.loja_ref?.trim() || "-" : formatarCnpj(r.cnpj_destino),
      lojaEncontrada: !!r.loja_encontrada,
      prazoPagamento: r.prazos?.trim() || "-",
      qtdPecas: qtd,
      valorTotal: r.valor_total ?? "0",
    });
  }

  // Grupos ordenados pelo fornecedor com MAIS peças faturadas no período primeiro.
  const todosGrupos = [...porFornecedor.values()].sort(
    (a, b) => b.somaPecas - a.somaPecas || a.fornecedor.localeCompare(b.fornecedor, "pt-BR")
  );
  const grupos = todosGrupos.slice(
    offsetFornecedores,
    offsetFornecedores + CONFERENCIA_FORNECEDORES_POR_PAGINA
  );

  return {
    grupos,
    totalFornecedores: todosGrupos.length,
    totalNotas: rows.length,
    pagina: f.pagina,
    porPagina: CONFERENCIA_FORNECEDORES_POR_PAGINA,
  };
}
