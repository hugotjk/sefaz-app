import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POR_PAGINA_OPCOES = [25, 50, 100];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const pagina = Math.max(1, parseInt(sp.get("pagina") ?? "1", 10) || 1);
  const porPaginaRaw = parseInt(sp.get("porPagina") ?? "25", 10);
  const porPagina = POR_PAGINA_OPCOES.includes(porPaginaRaw) ? porPaginaRaw : 25;
  const ordem: "asc" | "desc" = sp.get("ordem") === "asc" ? "asc" : "desc";

  const [total, notas] = await Promise.all([
    prisma.note.count(),
    prisma.note.findMany({
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
        _count: { select: { eventos: true } },
        certificate: { select: { razaoSocial: true, cnpj: true } },
      },
    }),
  ]);

  // Quais das notas desta página já têm o XML completo (filtro roda no banco;
  // só o `chaveAcesso` volta, nada do XML).
  const chaves = notas.map((n) => n.chaveAcesso);
  const comXml = new Set(
    (
      await prisma.note.findMany({
        where: { chaveAcesso: { in: chaves }, NOT: { xmlCompleto: "" } },
        select: { chaveAcesso: true },
      })
    ).map((n) => n.chaveAcesso)
  );

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
    temXmlCompleto: comXml.has(nota.chaveAcesso),
  }));

  return NextResponse.json({ notas: linhas, total, pagina, porPagina, ordem });
}
