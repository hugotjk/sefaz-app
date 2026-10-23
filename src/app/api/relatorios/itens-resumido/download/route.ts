import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { gerarXlsxItensResumido, parseFiltrosItensResumido } from "@/lib/relatorio-itens-resumido";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  try {
    const f = parseFiltrosItensResumido(req.nextUrl.searchParams);
    const nome = `itens_resumido_${f.dataInicial || "inicio"}_a_${f.dataFinal || "hoje"}.xlsx`;
    const stream = gerarXlsxItensResumido(f);
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nome}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[itens-resumido/download]", err);
    return NextResponse.json({ error: err?.message ?? "Erro ao gerar o arquivo." }, { status: 500 });
  }
}
