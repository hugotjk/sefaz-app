import { NextRequest, NextResponse } from "next/server";
import { gerarAlteracaoCadastroXlsx, nomeArquivoAlteracaoCadastro } from "@/lib/exportar-alteracao-cadastro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Body: { chaves: string[] } — chaves JSON.stringify([modelo, referencia]) marcadas na tela.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body?.chaves) || body.chaves.length === 0) {
      return NextResponse.json({ error: "Nenhum produto selecionado." }, { status: 400 });
    }
    const { buffer, resumo } = await gerarAlteracaoCadastroXlsx(body.chaves);
    const nome = nomeArquivoAlteracaoCadastro();
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
    console.error("[conferencia-sem-ean/exportar]", err);
    return NextResponse.json({ error: err?.message ?? "Erro ao gerar o arquivo." }, { status: 500 });
  }
}
