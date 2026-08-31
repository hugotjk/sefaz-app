import { NextRequest, NextResponse } from "next/server";
import { obterXmlNota } from "@/lib/obter-xml-nota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { chave: string } }) {
  const r = await obterXmlNota(params.chave);
  if ("erro" in r) {
    return NextResponse.json({ error: r.erro }, { status: r.status });
  }

  return new NextResponse(r.xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="NFe-${params.chave}.xml"`,
      "Cache-Control": "no-store",
    },
  });
}
