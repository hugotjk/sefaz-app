import { NextRequest, NextResponse } from "next/server";
import { gerarAlteracaoPrecoXlsx, nomeArquivoAlteracao } from "@/lib/exportar-alteracao-preco";
import { parseFiltrosConferenciaMkp } from "@/lib/conferencia-mkp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Body: { chaves: string[], emitente?, modelo?, dataInicial?, dataFinal? } — mesmas chaves e filtros da tela.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body?.chaves) || body.chaves.length === 0) {
      return NextResponse.json({ error: "Nenhuma referência selecionada." }, { status: 400 });
    }
    const sp = new URLSearchParams();
    for (const k of ["emitente", "modelo", "dataInicial", "dataFinal"]) if (body?.[k]) sp.set(k, String(body[k]));
    const { buffer, resumo } = await gerarAlteracaoPrecoXlsx(body.chaves, parseFiltrosConferenciaMkp(sp));
    const nome = nomeArquivoAlteracao();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nome}"`,
        "X-Nome-Arquivo": nome,
        "X-Resumo": encodeURIComponent(JSON.stringify(resumo)),
        "Access-Control-Expose-Headers": "X-Nome-Arquivo, X-Resumo, Content-Disposition",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[alteracao-preco/exportar]", err);
    return NextResponse.json({ error: err?.message ?? "Erro ao gerar o arquivo." }, { status: 500 });
  }
}
