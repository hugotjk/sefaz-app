import { NextRequest, NextResponse } from "next/server";
import {
  montarRelatorio,
  parseFiltros,
  RelatorioTimeoutError,
} from "@/lib/relatorio-movimentacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const filtros = parseFiltros(req.nextUrl.searchParams);
    const resultado = await montarRelatorio(filtros);
    return NextResponse.json(resultado);
  } catch (err: any) {
    if (err instanceof RelatorioTimeoutError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("[movimentacao-resumida]", err);
    return NextResponse.json(
      { error: err?.message ?? "Erro ao montar o relatório." },
      { status: 500 }
    );
  }
}
