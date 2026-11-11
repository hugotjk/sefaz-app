import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { salvarCertificadoLoja } from "@/lib/emissor-certificado";

export const runtime = "nodejs";

/** Envia o .pfx de UMA loja: confere senha e se o CNPJ do certificado é o da loja. */
export async function POST(req: NextRequest, { params }: { params: { cnpj: string } }) {
  const loja = await prisma.emissorLoja.findUnique({ where: { cnpj: params.cnpj }, select: { cnpj: true } });
  if (!loja) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });

  const form = await req.formData();
  const senha = form.get("senha");
  const arquivo = form.get("certificado");
  if (typeof senha !== "string" || !senha)
    return NextResponse.json({ error: "Informe a senha do certificado." }, { status: 400 });
  if (!(arquivo instanceof File))
    return NextResponse.json({ error: "Envie o arquivo .pfx." }, { status: 400 });

  try {
    const info = await salvarCertificadoLoja(
      params.cnpj, arquivo.name, Buffer.from(await arquivo.arrayBuffer()).toString("base64"), senha
    );
    return NextResponse.json({ ok: true, validUntil: info.validUntil });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro no certificado." }, { status: 400 });
  }
}
