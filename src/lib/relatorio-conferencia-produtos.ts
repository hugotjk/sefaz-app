import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const CONFERENCIA_PRODUTOS_POR_PAGINA = 50;

export interface FiltrosConferenciaProdutos {
  emitente: string; // texto livre (contains, case-insensitive) — filtra a lista principal
  dataInicial: string; // YYYY-MM-DD (data de emissão da nota)
  dataFinal: string; // YYYY-MM-DD
  pagina: number;
}

export interface LinhaConferenciaProduto {
  id: string;
  chaveAcesso: string;
  numeroNota: string | null;
  dataEmissao: string | null;
  emitenteNome: string | null;
  codigoProduto: string;
  descricao: string;
  ean: string | null;
  fornecedorIdentificado: string | null;
  modeloIdentificado: string | null;
  comRegraEspecifica: boolean;
}

export interface FornecedorSemRegra {
  emitente: string;
  itens: number;
}

export interface ResultadoConferenciaProdutos {
  linhas: LinhaConferenciaProduto[];
  total: number;
  pagina: number;
  porPagina: number;
  // Fornecedores (emitentes) que têm itens em NotaItem mas ainda SEM regra
  // completa de identificação (modelo nulo OU referência sem regra própria).
  // Nenhum item deles entra na lista principal — viram este aviso.
  semRegra: FornecedorSemRegra[];
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function parseFiltrosConferenciaProdutos(
  sp: URLSearchParams
): FiltrosConferenciaProdutos {
  const hoje = new Date();
  const trintaDias = new Date(hoje.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    emitente: (sp.get("emitente") ?? "").trim(),
    dataInicial: (sp.get("dataInicial") ?? "").trim() || ymd(trintaDias),
    dataFinal: (sp.get("dataFinal") ?? "").trim() || ymd(hoje),
    pagina: Math.max(1, parseInt(sp.get("pagina") ?? "1", 10) || 1),
  };
}

export async function montarConferenciaProdutos(
  f: FiltrosConferenciaProdutos
): Promise<ResultadoConferenciaProdutos> {
  const skip = (f.pagina - 1) * CONFERENCIA_PRODUTOS_POR_PAGINA;

  // Intervalo de data de emissão (inclui o dia final inteiro). Datas inválidas
  // são ignoradas.
  const gte = new Date(`${f.dataInicial}T00:00:00.000Z`);
  const lte = new Date(`${f.dataFinal}T23:59:59.999Z`);
  const temGte = !Number.isNaN(gte.getTime());
  const temLte = !Number.isNaN(lte.getTime());
  const intervalo: Prisma.DateTimeFilter = {};
  if (temGte) intervalo.gte = gte;
  if (temLte) intervalo.lte = lte;
  const dataEmissaoFiltro = temGte || temLte ? { dataEmissao: intervalo } : {};

  // 1. Emitentes que JÁ têm regra COMPLETA ensinada = têm ao menos 1 NotaItem
  //    com modelo identificado E referência com regra própria. É propriedade
  //    do fornecedor -> calculado GLOBAL (sem filtro de data).
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

  // 2. Lista principal: itens SEM cadastro, de emitentes COM regra completa,
  //    dentro do intervalo de data (+ filtro de texto de emitente, se houver).
  const noteWhere: Prisma.NoteWhereInput = {
    ...dataEmissaoFiltro,
    AND: [
      { emitenteNome: { in: emitentesComRegra } },
      ...(f.emitente
        ? [{ emitenteNome: { contains: f.emitente, mode: "insensitive" as const } }]
        : []),
    ],
  };
  const where: Prisma.NotaItemWhereInput = { temCadastro: false, note: noteWhere };

  const [total, itens] = await Promise.all([
    prisma.notaItem.count({ where }),
    prisma.notaItem.findMany({
      where,
      orderBy: [{ note: { dataEmissao: "desc" } }, { id: "asc" }],
      skip,
      take: CONFERENCIA_PRODUTOS_POR_PAGINA,
      select: {
        id: true,
        codigoProduto: true,
        descricao: true,
        ean: true,
        referenciaFornecedorIdentificada: true,
        modeloIdentificado: true,
        referenciaComRegraEspecifica: true,
        note: {
          select: {
            chaveAcesso: true,
            numero: true,
            dataEmissao: true,
            emitenteNome: true,
          },
        },
      },
    }),
  ]);

  // 3. Aviso "fornecedores sem regra": emitentes com itens de regra
  //    incompleta (modelo nulo OU sem regra própria) que NÃO estão na lista de
  //    "com regra completa". Respeita o intervalo de data; ignora o filtro de
  //    texto (é uma visão geral de "o que falta ensinar").
  const cortesArr: Prisma.Sql[] = [];
  if (temGte) cortesArr.push(Prisma.sql`AND n."dataEmissao" >= ${gte}`);
  if (temLte) cortesArr.push(Prisma.sql`AND n."dataEmissao" <= ${lte}`);
  const cortesData = cortesArr.length ? Prisma.join(cortesArr, " ") : Prisma.empty;
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
      ${cortesData}
      ${excluirComRegra}
    GROUP BY 1
    ORDER BY itens DESC, emitente ASC
  `);

  const linhas: LinhaConferenciaProduto[] = itens.map((it) => ({
    id: it.id,
    chaveAcesso: it.note.chaveAcesso,
    numeroNota: it.note.numero,
    dataEmissao: it.note.dataEmissao ? it.note.dataEmissao.toISOString() : null,
    emitenteNome: it.note.emitenteNome,
    codigoProduto: it.codigoProduto,
    descricao: it.descricao,
    ean: it.ean,
    fornecedorIdentificado: it.referenciaFornecedorIdentificada,
    modeloIdentificado: it.modeloIdentificado,
    comRegraEspecifica: it.referenciaComRegraEspecifica,
  }));

  return {
    linhas,
    total,
    pagina: f.pagina,
    porPagina: CONFERENCIA_PRODUTOS_POR_PAGINA,
    semRegra: semRegraRows.map((r) => ({
      emitente: r.emitente,
      itens: Number(r.itens),
    })),
  };
}
