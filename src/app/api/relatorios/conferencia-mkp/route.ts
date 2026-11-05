import { NextRequest, NextResponse } from "next/server";
import { montarConferenciaMkp, parseFiltrosConferenciaMkp } from "@/lib/conferencia-mkp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const filtros = parseFiltrosConferenciaMkp(req.nextUrl.searchParams);
    return NextResponse.json(await montarConferenciaMkp(filtros));
  } catch (err: any) {
    console.error("[conferencia-mkp]", err);
    return NextResponse.json({ error: err?.message ?? "Erro ao montar o relatório." }, { status: 500 });
  }
}
