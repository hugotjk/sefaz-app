import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type OrdenarPor = "dataEmissao" | "notaFiscal" | "fornecedor" | "modelo" | "loja";
const ORDENAR_POR: OrdenarPor[] = ["dataEmissao", "notaFiscal", "fornecedor", "modelo", "loja"];

export const CONFERENCIA_POR_PAGINA = 50;

export interface FiltrosConferencia {
  ordenarPor: OrdenarPor;
  ordem: "asc" | "desc";
  pagina: number;
}

export interface LinhaConferencia {
  id: string;
  fornecedor: string;
  modelo: string;
  dataEmissao: string | null;
  loja: string;
  lojaEncontrada: boolean;
  notaFiscal: string;
  prazoPagamento: string;
  qtdPecas: number;
}

export interface ResultadoConferencia {
  linhas: LinhaConferencia[];
  total: number;
  pagina: number;
  porPagina: number;
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
  prazos: string | null;
  loja_encontrada: boolean;
  total_rows: number | bigint;
}

export function parseFiltrosConferencia(sp: URLSearchParams): FiltrosConferencia {
  const op = sp.get("ordenarPor") as OrdenarPor | null;
  return {
    ordenarPor: op && ORDENAR_POR.includes(op) ? op : "dataEmissao",
    ordem: sp.get("ordem") === "asc" ? "asc" : "desc",
    pagina: Math.max(1, parseInt(sp.get("pagina") ?? "1", 10) || 1),
  };
}

function formatarCnpj(v: string): string {
  const d = (v || "").replace(/\D/g, "").padStart(14, "0").slice(-14);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Note.numero -> "000.000.000" (9 dígitos com zeros à esquerda). */
function formatarNotaFiscal(numero: string | null): string {
  const d = (numero ?? "").replace(/\D/g, "");
  if (!d) return "-";
  const p = d.padStart(9, "0").slice(-9);
  return `${p.slice(0, 3)}.${p.slice(3, 6)}.${p.slice(6, 9)}`;
}

export async function montarConferenciaPrazo(
  f: FiltrosConferencia
): Promise<ResultadoConferencia> {
  const dir = f.ordem === "asc" ? Prisma.raw("ASC") : Prisma.raw("DESC");
  const offset = Math.max(0, (f.pagina - 1) * CONFERENCIA_POR_PAGINA);

  // Ordenação. Fornecedor/Modelo/Loja NÃO ordenam alfabeticamente: ordenam
  // pela SOMA de peças de TODAS as notas daquele grupo (window function),
  // maior primeiro por padrão.
  let orderBy: Prisma.Sql;
  switch (f.ordenarPor) {
    case "notaFiscal":
      orderBy = Prisma.sql`(CASE WHEN numero ~ '^[0-9]+$' THEN numero::bigint END) ${dir} NULLS LAST, b.id`;
      break;
    case "fornecedor":
      orderBy = Prisma.sql`soma_fornecedor ${dir}, lower(coalesce(fornecedor,'')) ASC, b.id`;
      break;
    case "modelo":
      orderBy = Prisma.sql`soma_modelo ${dir}, lower(coalesce(modelo,'')) ASC, b.id`;
      break;
    case "loja":
      orderBy = Prisma.sql`soma_loja ${dir}, lower(coalesce(loja_ref, cnpj_destino)) ASC, b.id`;
      break;
    default: // dataEmissao — mais recente primeiro por padrão
      orderBy = Prisma.sql`data_emissao ${dir} NULLS LAST, b.id`;
  }

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
    ),
    base AS (
      SELECT
        n.id,
        n."emitenteNome"          AS fornecedor,
        n."dataEmissao"           AS data_emissao,
        n.numero                  AS numero,
        n."cnpjDestino"           AS cnpj_destino,
        lr.loja                   AS loja_ref,
        NULLIF(ia.modelo_moda, '') AS modelo,
        COALESCE(ia.qtd_pecas, 0)::float8 AS qtd_pecas,
        da.prazos                 AS prazos,
        (lr.cnpj IS NOT NULL)     AS loja_encontrada
      FROM "Note" n
      LEFT JOIN item_agg ia ON ia.nid = n.id
      LEFT JOIN dup_agg  da ON da.nid = n.id
      LEFT JOIN "LojaReferencia" lr ON lr.cnpj = n."cnpjDestino"
    )
    SELECT
      b.*,
      SUM(qtd_pecas) OVER (PARTITION BY COALESCE(fornecedor, '')) AS soma_fornecedor,
      SUM(qtd_pecas) OVER (PARTITION BY COALESCE(modelo, ''))     AS soma_modelo,
      SUM(qtd_pecas) OVER (PARTITION BY COALESCE(loja_ref, cnpj_destino)) AS soma_loja,
      COUNT(*) OVER () AS total_rows
    FROM base b
    ORDER BY ${orderBy}
    LIMIT ${CONFERENCIA_POR_PAGINA} OFFSET ${offset}
  `);

  const total = rows.length ? Number(rows[0].total_rows) : 0;

  const linhas: LinhaConferencia[] = rows.map((r) => ({
    id: r.id,
    fornecedor: r.fornecedor?.trim() || "-",
    modelo: r.modelo?.trim() || "-",
    dataEmissao: r.data_emissao ? r.data_emissao.toISOString() : null,
    loja: r.loja_encontrada ? r.loja_ref?.trim() || "-" : formatarCnpj(r.cnpj_destino),
    lojaEncontrada: !!r.loja_encontrada,
    notaFiscal: formatarNotaFiscal(r.numero),
    prazoPagamento: r.prazos?.trim() || "-",
    qtdPecas: Number(r.qtd_pecas ?? 0),
  }));

  return { linhas, total, pagina: f.pagina, porPagina: CONFERENCIA_POR_PAGINA };
}
