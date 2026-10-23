import { NextRequest, NextResponse } from "next/server";
import { opcoesItensResumido, parseFiltrosItensResumido } from "@/lib/relatorio-itens-resumido";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Listas das caixas de seleção (emitentes, gestores, lojas) dentro do período.
export async function GET(req: NextRequest) {
  try {
    const f = parseFiltrosItensResumido(req.nextUrl.searchParams);
    return NextResponse.json(await opcoesItensResumido(f));
  } catch (err: any) {
    console.error("[itens-resumido/opcoes]", err);
    return NextResponse.json({ error: err?.message ?? "Erro ao carregar as opções." }, { status: 500 });
  }
}
