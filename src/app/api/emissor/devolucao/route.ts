import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  CNPJ_CONTADOR_PADRAO,
  lerNotaOriginal,
  montarDevolucao,
  textoInfCpl,
} from "@/lib/nfe-devolucao";

export const runtime = "nodejs";

/**
 * POST multipart:
 *  - acao=analisar: xml (NF-e original) -> itens + loja emitente (a que recebeu a nota)
 *  - acao=gerar:    xml + selecao (JSON [{nItem,qtd}]) + infCpl + contador ("1"/"0")
 *                   -> XML da devolução (PRÉVIA, sem assinatura, não enviado, não consome número)
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const acao = form.get("acao");
  const arquivo = form.get("xml");
  if (!(arquivo instanceof File)) return NextResponse.json({ error: "Envie o XML da nota original." }, { status: 400 });

  let original;
  try {
    original = lerNotaOriginal(await arquivo.text());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "XML inválido." }, { status: 400 });
  }

  const loja = await prisma.emissorLoja.findUnique({ where: { cnpj: original.destCnpj } });
  if (!loja)
    return NextResponse.json(
      { error: `O destinatário da nota (CNPJ ${original.destCnpj}) não está cadastrado em Lojas e certificados.` },
      { status: 400 }
    );

  if (acao === "analisar") {
    return NextResponse.json({
      original,
      loja: {
        cnpj: loja.cnpj, razaoSocial: loja.razaoSocial, crt: loja.crt,
        serie: loja.serie, proximoNumero: loja.proximoNumero,
      },
      contadorPadrao: CNPJ_CONTADOR_PADRAO,
      infCplModelo: textoInfCpl(loja, original.numero, "{CASE}"),
    });
  }

  if (acao === "gerar") {
    if (loja.serie == null)
      return NextResponse.json({ error: "Defina a série própria da loja antes de gerar." }, { status: 400 });
    let selecao: { nItem: number; qtd: number }[];
    try {
      selecao = JSON.parse(String(form.get("selecao") ?? "[]"));
    } catch {
      return NextResponse.json({ error: "Seleção inválida." }, { status: 400 });
    }
    try {
      const r = montarDevolucao({
        loja, original, selecao,
        serie: loja.serie, numero: loja.proximoNumero,
        infCpl: String(form.get("infCpl") ?? ""),
        contadorCnpj: form.get("contador") === "1" ? CNPJ_CONTADOR_PADRAO : null,
      });
      return NextResponse.json({ ...r, serie: loja.serie, numero: loja.proximoNumero });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "Erro ao gerar." }, { status: 400 });
    }
  }
  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
