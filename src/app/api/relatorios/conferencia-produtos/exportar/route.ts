import { NextRequest, NextResponse } from "next/server";
import {
  gerarCadastroXlsx,
  nomeArquivoCadastro,
  parseChaves,
} from "@/lib/exportar-cadastro-produtos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Gera o .xlsx (padrão do Guia de Importação de Produtos WQS) dos produtos
// marcados na Conferência de Produtos. Body: { chaves: string[] } — as mesmas
// chaves JSON([modelo, referencia]) da tela.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const pares = parseChaves(body?.chaves);
    if (pares.length === 0) {
      return NextResponse.json({ error: "Nenhum produto selecionado." }, { status: 400 });
    }
    const { buffer, resumo } = await gerarCadastroXlsx(pares);
    const nome = nomeArquivoCadastro();
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
    console.error("[conferencia-produtos/exportar]", err);
    return NextResponse.json({ error: err?.message ?? "Erro ao gerar o arquivo." }, { status: 500 });
  }
}
