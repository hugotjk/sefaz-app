import { NextRequest, NextResponse } from "next/server";
import { obterXmlNota } from "@/lib/obter-xml-nota";
import { parseNFeXml } from "@/lib/parse-nfe-xml";
import { gerarDanfePdf } from "@/lib/danfe-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(_req: NextRequest, { params }: { params: { chave: string } }) {
  const r = await obterXmlNota(params.chave);
  if ("erro" in r) {
    return NextResponse.json({ error: r.erro }, { status: r.status });
  }

  let nfe;
  try {
    nfe = parseNFeXml(r.xml);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Não foi possível interpretar o XML desta nota." },
      { status: 422 }
    );
  }

  try {
    const pdf = await gerarDanfePdf(nfe);
    return new NextResponse(pdf as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="DANFE-${params.chave}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Erro ao gerar o PDF do DANFE." },
      { status: 500 }
    );
  }
}
