import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cancelarEmissao, consultarEmissao, emitir } from "@/lib/emissor-envio";
import { gerarDanfePdf } from "@/lib/danfe-pdf";
import { parseNFeXml } from "@/lib/parse-nfe-xml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download: ?tipo=xml (autorizado, ou assinado se ainda não autorizada) | danfe */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const e = await prisma.emissaoNfe.findUnique({ where: { id: params.id } });
  if (!e) return NextResponse.json({ error: "Não encontrada." }, { status: 404 });
  const tipo = req.nextUrl.searchParams.get("tipo") ?? "xml";
  const prefixo = e.ambiente === 2 ? "HOMOLOG_" : "";
  if (tipo === "danfe") {
    if (!e.xmlAutorizado) return NextResponse.json({ error: "A nota ainda não foi autorizada." }, { status: 400 });
    const pdf = await gerarDanfePdf(parseNFeXml(e.xmlAutorizado));
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${prefixo}DANFE_${e.chave}.pdf"` },
    });
  }
  if (tipo === "cancelamento") {
    if (!e.xmlCancelamento) return NextResponse.json({ error: "Nota não cancelada." }, { status: 400 });
    return new NextResponse(e.xmlCancelamento, {
      headers: { "Content-Type": "application/xml", "Content-Disposition": `attachment; filename="${prefixo}CANC_${e.chave}.xml"` },
    });
  }
  const xml = e.xmlAutorizado ?? e.xmlAssinado;
  if (!xml) return NextResponse.json({ error: "Sem XML." }, { status: 404 });
  return new NextResponse(xml, {
    headers: { "Content-Type": "application/xml", "Content-Disposition": `attachment; filename="${prefixo}NFe_${e.chave}.xml"` },
  });
}

/** acao: consultar (situação na SEFAZ pela chave) | reenviar (mesmos dados e número) */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { acao, justificativa } = await req.json().catch(() => ({}));
  try {
    if (acao === "cancelar") return NextResponse.json({ emissao: await cancelarEmissao(params.id, String(justificativa ?? "")) });
    if (acao === "consultar") return NextResponse.json({ emissao: await consultarEmissao(params.id) });
    if (acao === "reenviar") {
      const e = await prisma.emissaoNfe.findUnique({ where: { id: params.id } });
      if (!e) return NextResponse.json({ error: "Não encontrada." }, { status: 404 });
      if (!["REJEITADA", "INCERTA"].includes(e.status))
        return NextResponse.json({ error: "Só é possível reenviar notas rejeitadas." }, { status: 400 });
      if (e.status === "INCERTA") await consultarEmissao(params.id); // evita duplicar
      const atual = await prisma.emissaoNfe.findUniqueOrThrow({ where: { id: params.id } });
      if (atual.status !== "REJEITADA") return NextResponse.json({ emissao: atual });
      const emissao = await emitir({
        xmlOriginal: e.xmlOriginal, selecao: e.selecao as any, caso: e.caso, infCpl: e.infCpl,
        contador: e.contador, ambiente: e.ambiente as 1 | 2, emissaoId: e.id,
      });
      return NextResponse.json({ emissao });
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro." }, { status: 400 });
  }
}
