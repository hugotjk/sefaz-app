import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { statusXmlNota, TAMANHO_MINIMO_XML_COMPLETO } from "@/lib/nota-xml-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POR_PAGINA_OPCOES = [25, 50, 100];
const CAMPOS_BUSCA = ["conteudo", "emitente", "chave", "numero"] as const;
type CampoBusca = (typeof CAMPOS_BUSCA)[number];

function montarWhere(sp: URLSearchParams): Prisma.NoteWhereInput {
  const where: Prisma.NoteWhereInput = {};

  const certificateId = sp.get("certificateId")?.trim();
  if (certificateId) where.certificateId = certificateId;

  // Intervalo de data de emissão (inputs date -> "YYYY-MM-DD"). Inclui o dia
  // final inteiro. Datas inválidas são ignoradas.
  const dataInicial = sp.get("dataInicial")?.trim();
  const dataFinal = sp.get("dataFinal")?.trim();
  const intervalo: Prisma.DateTimeFilter = {};
  if (dataInicial) {
    const d = new Date(`${dataInicial}T00:00:00.000Z`);
    if (!Number.isNaN(d.getTime())) intervalo.gte = d;
  }
  if (dataFinal) {
    const d = new Date(`${dataFinal}T23:59:59.999Z`);
    if (!Number.isNaN(d.getTime())) intervalo.lte = d;
  }
  if (intervalo.gte || intervalo.lte) where.dataEmissao = intervalo;

  const termo = sp.get("buscaTermo")?.trim();
  const campo = (sp.get("buscaCampo") ?? "") as CampoBusca;
  if (termo && CAMPOS_BUSCA.includes(campo)) {
    const contemI = { contains: termo, mode: "insensitive" as const };
    if (campo === "emitente") {
      where.OR = [{ emitenteNome: contemI }, { emitenteCnpj: contemI }];
    } else if (campo === "chave") {
      where.chaveAcesso = { contains: termo };
    } else if (campo === "numero") {
      where.numero = { contains: termo };
    } else if (campo === "conteudo") {
      where.xmlCompleto = contemI;
    }
  }

  return where;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const pagina = Math.max(1, parseInt(sp.get("pagina") ?? "1", 10) || 1);
  const porPaginaRaw = parseInt(sp.get("porPagina") ?? "25", 10);
  const porPagina = POR_PAGINA_OPCOES.includes(porPaginaRaw) ? porPaginaRaw : 25;
  const ordem: "asc" | "desc" = sp.get("ordem") === "asc" ? "asc" : "desc";

  const where = montarWhere(sp);

  const [total, notas] = await Promise.all([
    prisma.note.count({ where }),
    prisma.note.findMany({
      where,
      orderBy: { dataEmissao: { sort: ordem, nulls: "last" } },
      skip: (pagina - 1) * porPagina,
      take: porPagina,
      // `select` explícito: NÃO traz `xmlCompleto` (string enorme) na listagem.
      select: {
        chaveAcesso: true,
        numero: true,
        dataEmissao: true,
        tipoOperacao: true,
        valorTotal: true,
        emitenteNome: true,
        emitenteCnpj: true,
        status: true,
        tentativasXml: true,
        _count: { select: { eventos: true } },
        certificate: { select: { razaoSocial: true, cnpj: true } },
      },
    }),
  ]);

  // Quais das notas desta página já têm o XML COMPLETO de verdade (não só o
  // resumo). Filtro por tamanho roda no banco; só o `chaveAcesso` volta, nada
  // do XML em si.
  const chaves = notas.map((n) => n.chaveAcesso);
  const comXml = chaves.length
    ? new Set(
        (
          await prisma.$queryRaw<{ chaveAcesso: string }[]>(Prisma.sql`
            SELECT "chaveAcesso" FROM "Note"
            WHERE "chaveAcesso" IN (${Prisma.join(chaves)})
              AND length("xmlCompleto") > ${TAMANHO_MINIMO_XML_COMPLETO}
          `)
        ).map((n) => n.chaveAcesso)
      )
    : new Set<string>();

  const linhas = notas.map((nota) => ({
    chaveAcesso: nota.chaveAcesso,
    numero: nota.numero,
    dataEmissao: nota.dataEmissao ? nota.dataEmissao.toISOString() : null,
    tipoOperacao: nota.tipoOperacao,
    valorTotal: nota.valorTotal?.toString() ?? "0",
    emitenteNome: nota.emitenteNome,
    emitenteCnpj: nota.emitenteCnpj,
    destinatarioNome: nota.certificate.razaoSocial || nota.certificate.cnpj,
    status: nota.status,
    qtdEventos: nota._count.eventos,
    statusXml: statusXmlNota({
      temXmlCompleto: comXml.has(nota.chaveAcesso),
      tentativasXml: nota.tentativasXml,
      dataEmissao: nota.dataEmissao,
    }),
  }));

  return NextResponse.json({ notas: linhas, total, pagina, porPagina, ordem });
}
