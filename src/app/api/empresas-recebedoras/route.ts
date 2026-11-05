import { NextResponse } from "next/server";
import { listarEmpresasRecebedoras } from "@/lib/empresas-recebedoras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ empresas: await listarEmpresasRecebedoras() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro" }, { status: 500 });
  }
}
