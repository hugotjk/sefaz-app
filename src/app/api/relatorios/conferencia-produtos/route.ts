import { NextRequest, NextResponse } from "next/server";
import {
  montarConferenciaProdutos,
  parseFiltrosConferenciaProdutos,
} from "@/lib/relatorio-conferencia-produtos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const filtros = parseFiltrosConferenciaProdutos(req.nextUrl.searchParams);
    const resultado = await montarConferenciaProdutos(filtros);
    return NextResponse.json(resultado);
  } catch (err: any) {
    console.error("[conferencia-produtos]", err);
    return NextResponse.json(
      { error: err?.message ?? "Erro ao montar o relatório." },
      { status: 500 }
    );
  }
}
