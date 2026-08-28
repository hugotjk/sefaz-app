import { NextRequest, NextResponse } from "next/server";
import { listarEmpresas, obterFilial, listarLojas } from "@/lib/pdvapi";

// Rota temporária só pra facilitar o desenvolvimento — dá pra remover depois
// que o mapeamento de campos estiver validado e confirmado.
export async function GET(req: NextRequest) {
  const tipo = req.nextUrl.searchParams.get("tipo") ?? "empresas";
  const codigoFilial = req.nextUrl.searchParams.get("codigoFilial");

  try {
    if (tipo === "empresas") {
      const empresas = await listarEmpresas();
      return NextResponse.json({ empresas });
    }
    if (tipo === "filial" && codigoFilial) {
      const filial = await obterFilial(Number(codigoFilial));
      return NextResponse.json({ filial });
    }
    if (tipo === "lojas") {
      const lojas = await listarLojas();
      return NextResponse.json({ lojas });
    }
    return NextResponse.json({ error: "Use ?tipo=empresas, ?tipo=lojas ou ?tipo=filial&codigoFilial=330" });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro" }, { status: 500 });
  }
}
