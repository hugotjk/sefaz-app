import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { lerNotaOriginal } from "@/lib/nfe-devolucao";

export const dynamic = "force-dynamic";

export async function GET() {
  const rascunhos = await prisma.emissaoRascunho.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, lojaCnpj: true, fornecedor: true, notaOriginalNumero: true, caso: true, selecao: true, updatedAt: true },
  });
  const lojas = await prisma.emissorLoja.findMany({
    where: { cnpj: { in: Array.from(new Set(rascunhos.map((r) => r.lojaCnpj))) } },
    select: { cnpj: true, razaoSocial: true },
  });
  const nome = new Map(lojas.map((l) => [l.cnpj, l.razaoSocial]));
  return NextResponse.json({
    rascunhos: rascunhos.map((r) => ({
      ...r, loja: nome.get(r.lojaCnpj) ?? r.lojaCnpj,
      itens: Array.isArray(r.selecao) ? r.selecao.length : 0,
    })),
  });
}

/** Cria ou atualiza (se vier id) um rascunho. Não consome número nem fala com a SEFAZ. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const arquivo = form.get("xml");
  if (!(arquivo instanceof File)) return NextResponse.json({ error: "Envie o XML da nota original." }, { status: 400 });
  const xmlOriginal = await arquivo.text();
  let original;
  try {
    original = lerNotaOriginal(xmlOriginal);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "XML inválido." }, { status: 400 });
  }
  let selecao: unknown;
  try {
    selecao = JSON.parse(String(form.get("selecao") ?? "[]"));
  } catch {
    return NextResponse.json({ error: "Seleção inválida." }, { status: 400 });
  }
  const dados = {
    lojaCnpj: original.destCnpj,
    fornecedor: original.emitente.nome,
    notaOriginalNumero: original.numero,
    caso: String(form.get("caso") ?? ""),
    infCpl: form.get("infCpl") === null || form.get("personalizado") !== "1" ? null : String(form.get("infCpl")),
    contador: form.get("contador") === "1",
    selecao: selecao as any,
    xmlOriginal,
  };
  const id = String(form.get("id") ?? "");
  const existente = id ? await prisma.emissaoRascunho.findUnique({ where: { id }, select: { id: true } }) : null;
  const r = existente
    ? await prisma.emissaoRascunho.update({ where: { id }, data: dados, select: { id: true } })
    : await prisma.emissaoRascunho.create({ data: dados, select: { id: true } });
  return NextResponse.json({ id: r.id });
}
