import { NextRequest, NextResponse } from "next/server";
import { importarLojasReferenciaTsv } from "@/lib/importar-lojas-referencia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recebe a planilha de referência de lojas como TSV colado no corpo da
 * requisição (text/plain) e faz upsert por CNPJ.
 */
export async function POST(req: NextRequest) {
  const tsv = await req.text();
  if (!tsv || tsv.trim() === "") {
    return NextResponse.json({ error: "Corpo vazio — cole o TSV." }, { status: 400 });
  }
  try {
    const r = await importarLojasReferenciaTsv(tsv);
    return NextResponse.json(r);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Erro ao importar." },
      { status: 500 }
    );
  }
}
