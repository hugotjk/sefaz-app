import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { gerarDanfePadrao as gerarDanfePdf } from "@/lib/danfe-padrao";
import { parseNFeXml } from "@/lib/parse-nfe-xml";
import { emitir, PRODUCAO_LIBERADA, testarConexao } from "@/lib/emissor-envio";
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
  if (!loja) {
    if (acao === "analisar")
      return NextResponse.json({ original, lojaNaoCadastrada: true, destinatario: original.destinatario });
    return NextResponse.json({ error: "Loja destinatária não cadastrada." }, { status: 400 });
  }

  if (acao === "analisar") {
    return NextResponse.json({
      original,
      loja: {
        cnpj: loja.cnpj, razaoSocial: loja.razaoSocial, crt: loja.crt,
        serie: loja.serie, proximoNumero: loja.proximoNumero,
      },
      contadorPadrao: CNPJ_CONTADOR_PADRAO,
      producaoLiberada: PRODUCAO_LIBERADA,
      infCplModelo: textoInfCpl(loja, original.numero, "{CASE}"),
    });
  }

  if (acao === "gerar" || acao === "previa-danfe") {
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
      if (acao === "previa-danfe") {
        const pdf = await gerarDanfePdf(parseNFeXml(r.xml), { previa: true });
        return new NextResponse(new Uint8Array(pdf), {
          headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="PREVIA_DANFE_${r.chave}.pdf"` },
        });
      }
      return NextResponse.json({ ...r, serie: loja.serie, numero: loja.proximoNumero });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "Erro ao gerar." }, { status: 400 });
    }
  }
  if (acao === "testar") {
    try {
      const amb = form.get("ambiente") === "1" ? 1 : 2;
      if (amb === 1 && !PRODUCAO_LIBERADA) throw new Error("Produção ainda não está liberada.");
      const r = await testarConexao(loja.cnpj, amb);
      return NextResponse.json(r);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "Falha ao conectar." }, { status: 400 });
    }
  }

  if (acao === "enviar") {
    let selecao: { nItem: number; qtd: number }[];
    try {
      selecao = JSON.parse(String(form.get("selecao") ?? "[]"));
    } catch {
      return NextResponse.json({ error: "Seleção inválida." }, { status: 400 });
    }
    const ambiente = form.get("ambiente") === "1" ? 1 : 2;
    try {
      const emissao = await emitir({
        xmlOriginal: await arquivo.text(), selecao,
        caso: String(form.get("caso") ?? ""), infCpl: String(form.get("infCpl") ?? ""),
        contador: form.get("contador") === "1", ambiente,
      });
      const rid = String(form.get("rascunhoId") ?? "");
      if (rid && emissao.status === "AUTORIZADA") await prisma.emissaoRascunho.deleteMany({ where: { id: rid } });
      return NextResponse.json({ emissao });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "Erro ao emitir." }, { status: 400 });
    }
  }
  return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
}
