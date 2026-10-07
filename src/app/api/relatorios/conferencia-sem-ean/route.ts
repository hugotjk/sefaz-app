import { NextRequest, NextResponse } from "next/server";
import {
  montarConferenciaSemEan,
  parseFiltrosConferenciaSemEan,
} from "@/lib/relatorio-conferencia-sem-ean";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const filtros = parseFiltrosConferenciaSemEan(req.nextUrl.searchParams);
    const resultado = await montarConferenciaSemEan(filtros);
    return NextResponse.json(resultado);
  } catch (err: any) {
    console.error("[conferencia-sem-ean]", err);
    return NextResponse.json(
      { error: err?.message ?? "Erro ao montar o relatório." },
      { status: 500 }
    );
  }
}
