import { NextRequest, NextResponse } from "next/server";
import {
  parseFiltrosItensResumido,
  resumirItensResumido,
} from "@/lib/relatorio-itens-resumido";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Contagem (notas / itens) do filtro atual — não gera o arquivo.
export async function GET(req: NextRequest) {
  try {
    const f = parseFiltrosItensResumido(req.nextUrl.searchParams);
    return NextResponse.json(await resumirItensResumido(f));
  } catch (err: any) {
    console.error("[itens-resumido]", err);
    return NextResponse.json({ error: err?.message ?? "Erro ao montar o relatório." }, { status: 500 });
  }
}
