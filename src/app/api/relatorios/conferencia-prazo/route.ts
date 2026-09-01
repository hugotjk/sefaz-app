import { NextRequest, NextResponse } from "next/server";
import {
  montarConferenciaPrazo,
  parseFiltrosConferencia,
} from "@/lib/relatorio-conferencia-prazo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const filtros = parseFiltrosConferencia(req.nextUrl.searchParams);
    const resultado = await montarConferenciaPrazo(filtros);
    return NextResponse.json(resultado);
  } catch (err: any) {
    console.error("[conferencia-prazo]", err);
    return NextResponse.json(
      { error: err?.message ?? "Erro ao montar o relatório." },
      { status: 500 }
    );
  }
}
