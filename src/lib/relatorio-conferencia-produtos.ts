import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const CONFERENCIA_PRODUTOS_POR_PAGINA = 50;

export interface FiltrosConferenciaProdutos {
  emitente: string; // texto livre (contains, case-insensitive) — filtra a lista principal
  // Filtro de data de emissão OPCIONAL. Vazio = todos os períodos. "Produto
  // único" não tem uma data natural, e produtos de meses atrás não devem ficar
  // escondidos por um padrão de 30 dias — por isso o padrão aqui é "tudo".
  dataInicial: string; // YYYY-MM-DD ou ""
  dataFinal: string; // YYYY-MM-DD ou ""
  pagina: number;
}

export interface LinhaConferenciaProduto {
  // identidade única do produto = (modelo, referência do fornecedor)
  chave: string;
  modelo: string | null;
  referencia: string | null;
  // do NotaItem mais recente do grupo:
  descricao: string;
  ean: string | null;
  emitenteNome: string | null;
  comRegraEspecifica: boolean;
  // em quantas notas distintas esse produto apareceu
  nNotas: number;
}

export interface FornecedorSemRegra {
  emitente: string;
  itens: number;
}

export interface ResultadoConferenciaProdutos {
  linhas: LinhaConferenciaProduto[];
  total: number; // total de PRODUTOS ÚNICOS (não de NotaItem)
  pagina: number;
  porPagina: number;
  semRegra: FornecedorSemRegra[];
}

export function parseFiltrosConferenciaProdutos(
  sp: URLSearchParams
): FiltrosConferenciaProdutos {
  return {
    emitente: (sp.get("emitente") ?? "").trim(),
    dataInicial: (sp.get("dataInicial") ?? "").trim(),
    dataFinal: (sp.get("dataFinal") ?? "").trim(),
    pagina: Math.max(1, parseInt(sp.get("pagina") ?? "1", 10) || 1),
  };
}

export async function montarConferenciaProdutos(
  f: FiltrosConferenciaProdutos
): Promise<ResultadoConferenciaProdutos> {
  const offset = (f.pagina - 1) * CONFERENCIA_PRODUTOS_POR_PAGINA;

  // Intervalo de data de emissão (opcional). Datas inválidas são ignoradas.
  const gte = f.dataInicial ? new Date(`${f.dataInicial}T00:00:00.000Z`) : null;
  const lte = f.dataFinal ? new Date(`${f.dataFinal}T23:59:59.999Z`) : null;
  const temGte = !!gte && !Number.isNaN(gte.getTime());
  const temLte = !!lte && !Number.isNaN(lte.getTime());
  const filtroGte = temGte ? Prisma.sql`AND n."dataEmissao" >= ${gte}` : Prisma.empty;
  const filtroLte = temLte ? Prisma.sql`AND n."dataEmissao" <= ${lte}` : Prisma.empty;

  // 1. Emitentes que JÁ têm regra COMPLETA ensinada = têm ao menos 1 NotaItem
  //    com modelo identificado E referência com regra própria. Propriedade do
  //    fornecedor -> GLOBAL (sem filtro de data).
  const comRegraRows = await prisma.$queryRaw<{ emitente: string | null }[]>(Prisma.sql`
    SELECT DISTINCT n."emitenteNome" AS emitente
    FROM "NotaItem" i
    JOIN "Note" n ON n.id = i."noteId"
    WHERE i."modeloIdentificado" IS NOT NULL
      AND i."referenciaComRegraEspecifica" = true
  `);
  const emitentesComRegra = comRegraRows
    .map((r) => r.emitente)
    .filter((e): e is string => !!e);

  // 3. Aviso "fornecedores sem regra": emitentes com itens de regra incompleta
  //    (modelo nulo OU sem regra própria) que NÃO estão na lista de "com regra
  //    completa". Respeita o intervalo de data; ignora o filtro de texto.
  const excluirComRegra = emitentesComRegra.length
    ? Prisma.sql`AND COALESCE(n."emitenteNome", '(sem emitente)') NOT IN (${Prisma.join(
        emitentesComRegra
      )})`
    : Prisma.empty;
  const semRegraRows = await prisma.$queryRaw<{ emitente: string; itens: number }[]>(Prisma.sql`
    SELECT COALESCE(n."emitenteNome", '(sem emitente)') AS emitente,
           COUNT(*)::int AS itens
    FROM "NotaItem" i
    JOIN "Note" n ON n.id = i."noteId"
    WHERE (i."modeloIdentificado" IS NULL OR i."referenciaComRegraEspecifica" = false)
      ${filtroGte} ${filtroLte} ${excluirComRegra}
    GROUP BY 1
    ORDER BY itens DESC, emitente ASC
  `);
  const semRegra = semRegraRows.map((r) => ({
    emitente: r.emitente,
    itens: Number(r.itens),
  }));

  // Sem nenhum fornecedor com regra -> lista principal vazia.
  if (emitentesComRegra.length === 0) {
    return {
      linhas: [],
      total: 0,
      pagina: f.pagina,
      porPagina: CONFERENCIA_PRODUTOS_POR_PAGINA,
      semRegra,
    };
  }

  const filtroEmitente = f.emitente
    ? Prisma.sql`AND n."emitenteNome" ILIKE ${"%" + f.emitente + "%"}`
    : Prisma.empty;

  // 2. Lista principal: 1 linha por produto único (modelo, referência do
  //    fornecedor). Descrição/EAN/emitente do NotaItem mais recente do grupo;
  //    contador de notas distintas. Só itens sem cadastro, de emitentes com
  //    regra completa.
  const rows = await prisma.$queryRaw<
    {
      modelo: string | null;
      referencia: string | null;
      descricao: string;
      ean: string | null;
      com_regra: boolean;
      emitente: string | null;
      n_notas: number;
      total_rows: number | bigint;
    }[]
  >(Prisma.sql`
    WITH base AS (
      SELECT
        i."modeloIdentificado"               AS modelo,
        i."referenciaFornecedorIdentificada" AS referencia,
        i."descricao"                        AS descricao,
        i."ean"                              AS ean,
        i."referenciaComRegraEspecifica"     AS com_regra,
        i."noteId"                           AS note_id,
        n."emitenteNome"                     AS emitente,
        n."dataEmissao"                      AS data_emissao
      FROM "NotaItem" i
      JOIN "Note" n ON n.id = i."noteId"
      WHERE i."temCadastro" = false
        AND n."emitenteNome" IN (${Prisma.join(emitentesComRegra)})
        ${filtroEmitente} ${filtroGte} ${filtroLte}
    ),
    grupos AS (
      SELECT DISTINCT ON (modelo, referencia)
        modelo, referencia, descricao, ean, com_regra, emitente
      FROM base
      ORDER BY modelo, referencia, data_emissao DESC NULLS LAST, note_id DESC
    ),
    cont AS (
      SELECT modelo, referencia, COUNT(DISTINCT note_id)::int AS n_notas
      FROM base
      GROUP BY modelo, referencia
    )
    SELECT g.modelo, g.referencia, g.descricao, g.ean, g.com_regra, g.emitente,
           c.n_notas,
           COUNT(*) OVER () AS total_rows
    FROM grupos g
    JOIN cont c
      ON c.modelo IS NOT DISTINCT FROM g.modelo
     AND c.referencia IS NOT DISTINCT FROM g.referencia
    ORDER BY lower(g.modelo) ASC NULLS LAST, lower(g.referencia) ASC NULLS LAST
    LIMIT ${CONFERENCIA_PRODUTOS_POR_PAGINA} OFFSET ${offset}
  `);

  const total = rows.length ? Number(rows[0].total_rows) : 0;

  const linhas: LinhaConferenciaProduto[] = rows.map((r) => ({
    chave: JSON.stringify([r.modelo, r.referencia]),
    modelo: r.modelo,
    referencia: r.referencia,
    descricao: r.descricao,
    ean: r.ean,
    emitenteNome: r.emitente,
    comRegraEspecifica: r.com_regra,
    nNotas: Number(r.n_notas),
  }));

  return {
    linhas,
    total,
    pagina: f.pagina,
    porPagina: CONFERENCIA_PRODUTOS_POR_PAGINA,
    semRegra,
  };
}
