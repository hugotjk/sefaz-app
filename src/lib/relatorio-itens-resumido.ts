import { Prisma } from "@prisma/client";
import { PassThrough } from "node:stream";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { parseNFeXml } from "@/lib/parse-nfe-xml";

/**
 * Relatório "Itens Resumido": uma linha por ITEM de nota fiscal recebida, com
 * as mesmas 17 colunas do "Relatório avançado de NF-e" do Arquivei, para
 * baixar em .xlsx. Os itens vêm direto do XML da nota (desconto, IPI, ICMS ST,
 * natureza da operação e dados adicionais não ficam em NotaItem).
 */

export type CampoBusca = "conteudo" | "emitente" | "chave" | "numero";

export interface FiltrosItensResumido {
  dataInicial: string; // YYYY-MM-DD ou ""
  dataFinal: string; // YYYY-MM-DD ou ""
  campo: CampoBusca;
  valor: string; // texto da busca (vazio = sem filtro de busca)
  gestor: string; // "" = todos
  loja: string; // "" = todas
}

export const COLUNAS_ITENS_RESUMIDO = [
  "Nome PJ Emitente",
  "CNPJ Destinatário",
  "Chave de Acesso",
  "Data Emissão",
  "Número",
  "Natureza Operação",
  "[Item] Código",
  "[Item] Descrição",
  "[Item] EAN",
  "[Item] NCM",
  "[Item] Quantidade",
  "[Item] Valor Unitário",
  "[Item] Desconto",
  "[Item] Valor ICMS ST",
  "[Item] Valor IPI",
  "[Item] Informações adicionais produto",
  "Dados Adicionais",
] as const;

export function parseFiltrosItensResumido(sp: URLSearchParams): FiltrosItensResumido {
  const campo = sp.get("campo") as CampoBusca | null;
  return {
    dataInicial: (sp.get("dataInicial") ?? "").trim(),
    dataFinal: (sp.get("dataFinal") ?? "").trim(),
    campo: campo === "emitente" || campo === "chave" || campo === "numero" ? campo : "conteudo",
    valor: (sp.get("valor") ?? "").trim(),
    gestor: (sp.get("gestor") ?? "").trim(),
    loja: (sp.get("loja") ?? "").trim(),
  };
}

function soDigitos(s: string) {
  return s.replace(/\D/g, "");
}

function sqlDatas(f: Pick<FiltrosItensResumido, "dataInicial" | "dataFinal">) {
  const gte = f.dataInicial ? new Date(`${f.dataInicial}T00:00:00.000Z`) : null;
  const lte = f.dataFinal ? new Date(`${f.dataFinal}T23:59:59.999Z`) : null;
  return [
    gte && !Number.isNaN(gte.getTime()) ? Prisma.sql`AND n."dataEmissao" >= ${gte}` : Prisma.empty,
    lte && !Number.isNaN(lte.getTime()) ? Prisma.sql`AND n."dataEmissao" <= ${lte}` : Prisma.empty,
  ];
}

/** Condições SQL sobre Note (n) / LojaReferencia (lr). "conteúdo" é filtrado nos itens. */
function sqlCondicoes(f: FiltrosItensResumido) {
  const [gte, lte] = sqlDatas(f);
  const conds: Prisma.Sql[] = [gte, lte];
  conds.push(Prisma.sql`AND n.status <> 'CANCELADA'`);
  if (f.gestor) conds.push(Prisma.sql`AND lr.gestor = ${f.gestor}`);
  if (f.loja) conds.push(Prisma.sql`AND lr.loja = ${f.loja}`);
  const v = f.valor;
  if (v) {
    if (f.campo === "emitente") {
      const dig = soDigitos(v);
      conds.push(
        dig.length >= 3
          ? Prisma.sql`AND (n."emitenteNome" ILIKE ${"%" + v + "%"} OR n."emitenteCnpj" LIKE ${"%" + dig + "%"})`
          : Prisma.sql`AND n."emitenteNome" ILIKE ${"%" + v + "%"}`
      );
    } else if (f.campo === "chave") {
      conds.push(Prisma.sql`AND n."chaveAcesso" LIKE ${"%" + (soDigitos(v) || v) + "%"}`);
    } else if (f.campo === "numero") {
      const num = soDigitos(v) || v;
      conds.push(Prisma.sql`AND (n.numero = ${num} OR ltrim(n.numero, '0') = ltrim(${num}, '0'))`);
    }
  }
  return Prisma.join(conds, " ");
}

export interface ResumoItensResumido {
  notas: number;
  itens: number; // estimativa pelos itens já gravados (NotaItem)
  semXml: number; // notas do filtro sem XML completo (não entram no arquivo)
}

export async function resumirItensResumido(f: FiltrosItensResumido): Promise<ResumoItensResumido> {
  const conds = sqlCondicoes(f);
  const filtroConteudo =
    f.campo === "conteudo" && f.valor
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM "NotaItem" i2 WHERE i2."noteId" = n.id AND (
            i2."descricao" ILIKE ${"%" + f.valor + "%"} OR i2."codigoProduto" ILIKE ${"%" + f.valor + "%"}
            OR i2."ean" ILIKE ${"%" + f.valor + "%"} OR i2."infAdProd" ILIKE ${"%" + f.valor + "%"}
            OR i2."referenciaFornecedorIdentificada" ILIKE ${"%" + f.valor + "%"}))`
      : Prisma.empty;
  const [r] = await prisma.$queryRaw<{ notas: number; itens: number; sem_xml: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS notas,
           COALESCE(SUM((SELECT COUNT(*) FROM "NotaItem" i WHERE i."noteId" = n.id)), 0)::int AS itens,
           COUNT(*) FILTER (WHERE n."xmlCompleto" = '')::int AS sem_xml
    FROM "Note" n
    LEFT JOIN "LojaReferencia" lr ON lr.cnpj = n."cnpjDestino"
    WHERE 1=1 ${conds} ${filtroConteudo}
  `);
  return { notas: r?.notas ?? 0, itens: r?.itens ?? 0, semXml: r?.sem_xml ?? 0 };
}

export interface OpcoesItensResumido {
  emitentes: string[];
  gestores: string[];
  lojas: string[];
}

/** Opções das caixas de seleção, dentro do período escolhido. */
export async function opcoesItensResumido(
  f: Pick<FiltrosItensResumido, "dataInicial" | "dataFinal">
): Promise<OpcoesItensResumido> {
  const [gte, lte] = sqlDatas(f);
  const [emit, gest, lojas] = await Promise.all([
    prisma.$queryRaw<{ v: string }[]>(Prisma.sql`
      SELECT DISTINCT n."emitenteNome" AS v FROM "Note" n
      WHERE n."emitenteNome" IS NOT NULL AND n.status <> 'CANCELADA' ${gte} ${lte}
      ORDER BY 1`),
    prisma.$queryRaw<{ v: string }[]>(Prisma.sql`
      SELECT DISTINCT lr.gestor AS v FROM "Note" n
      JOIN "LojaReferencia" lr ON lr.cnpj = n."cnpjDestino"
      WHERE lr.gestor IS NOT NULL AND lr.gestor <> '' ${gte} ${lte}
      ORDER BY 1`),
    prisma.$queryRaw<{ v: string }[]>(Prisma.sql`
      SELECT DISTINCT lr.loja AS v FROM "Note" n
      JOIN "LojaReferencia" lr ON lr.cnpj = n."cnpjDestino"
      WHERE lr.loja IS NOT NULL AND lr.loja <> '' ${gte} ${lte}
      ORDER BY 1`),
  ]);
  return {
    emitentes: emit.map((r) => r.v),
    gestores: gest.map((r) => r.v),
    lojas: lojas.map((r) => r.v),
  };
}

function numero(s: string): number | null {
  if (s === "" || s == null) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/**
 * Gera o .xlsx em streaming (não carrega o arquivo todo na memória) e devolve
 * o stream legível. As notas são lidas do banco em lotes e o XML de cada uma
 * é interpretado na hora.
 */
export function gerarXlsxItensResumido(f: FiltrosItensResumido): PassThrough {
  const saida = new PassThrough();
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: saida,
    useStyles: true,
    useSharedStrings: false,
  });
  const ws = wb.addWorksheet("relatorio");
  ws.columns = COLUNAS_ITENS_RESUMIDO.map((h, i) => ({
    header: h,
    width: Math.max(14, h.length + 2),
    ...(i === 3 ? { style: { numFmt: "dd/mm/yyyy" } } : {}),
  }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).commit();

  (async () => {
    const conds = sqlCondicoes(f);
    const termo = f.campo === "conteudo" ? f.valor.toLowerCase() : "";
    const LOTE = 100;

    // 1) ids das notas do filtro, já na ordem do arquivo (leve: só ids).
    const ids = (
      await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT n.id
        FROM "Note" n
        LEFT JOIN "LojaReferencia" lr ON lr.cnpj = n."cnpjDestino"
        WHERE n."xmlCompleto" <> '' ${conds}
        ORDER BY n."dataEmissao" ASC NULLS LAST, n.id ASC
      `)
    ).map((r) => r.id);

    // 2) lê o XML em lotes e escreve as linhas.
    for (let i = 0; i < ids.length; i += LOTE) {
      const lote = ids.slice(i, i + LOTE);
      const notas = await prisma.note.findMany({
        where: { id: { in: lote } },
        select: {
          id: true,
          emitenteNome: true,
          cnpjDestino: true,
          chaveAcesso: true,
          dataEmissao: true,
          numero: true,
          xmlCompleto: true,
        },
      });
      const porId = new Map(notas.map((n) => [n.id, n]));
      for (const id of lote) {
        const nota = porId.get(id);
        if (!nota) continue;
        let nfe;
        try {
          nfe = parseNFeXml(nota.xmlCompleto);
        } catch {
          continue; // XML ilegível: pula a nota
        }
        for (const it of nfe.itens) {
          if (termo) {
            const alvo = `${it.codigo} ${it.descricao} ${it.ean} ${it.infAdProd}`.toLowerCase();
            if (!alvo.includes(termo)) continue;
          }
          ws.addRow([
            nota.emitenteNome ?? nfe.emitente.nome,
            nota.cnpjDestino,
            nota.chaveAcesso,
            nota.dataEmissao,
            nota.numero ?? nfe.numero,
            nfe.natOp,
            it.codigo,
            it.descricao,
            it.ean,
            it.ncm,
            numero(it.quantidade),
            numero(it.valorUnitario),
            numero(it.valorDesconto),
            numero(it.valorIcmsSt),
            numero(it.valorIpi),
            it.infAdProd,
            nfe.informacoesComplementares,
          ]).commit();
        }
      }
    }
    await wb.commit();
  })().catch((e) => {
    console.error("[itens-resumido] erro ao gerar xlsx", e);
    saida.destroy(e instanceof Error ? e : new Error(String(e)));
  });

  return saida;
}
