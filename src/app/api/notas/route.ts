import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POR_PAGINA_OPCOES = [25, 50, 100];

type NotaComRelacoes = Prisma.NoteGetPayload<{
  include: {
    _count: { select: { eventos: true } };
    certificate: { select: { razaoSocial: true; cnpj: true } };
  };
}>;

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
      include: {
        _count: { select: { eventos: true } },
        certificate: { select: { razaoSocial: true, cnpj: true } },
      },
    }),
  ]);

  const linhas = notas.map((nota: NotaComRelacoes) => ({
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
  }));

  return NextResponse.json({ notas: linhas, total, pagina, porPagina, ordem });
}
