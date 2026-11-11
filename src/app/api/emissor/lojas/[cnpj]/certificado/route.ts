import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encryptCertificate } from "@/lib/crypto";
import { validarSenhaCertificado } from "@/lib/sefaz";
import { extrairInfoCertificado } from "@/lib/certificate-info";
import { inngest } from "@/lib/inngest";

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

  const pfxBase64 = Buffer.from(await arquivo.arrayBuffer()).toString("base64");
  if (!validarSenhaCertificado(pfxBase64, senha))
    return NextResponse.json({ error: "Senha incorreta." }, { status: 400 });

  let info;
  try {
    info = extrairInfoCertificado(pfxBase64, senha);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Certificado ilegível." }, { status: 400 });
  }
  if (info.cnpj !== params.cnpj)
    return NextResponse.json(
      { error: `Esse certificado é do CNPJ ${info.cnpj || "desconhecido"}, não da loja ${params.cnpj}.` },
      { status: 400 }
    );
  if (info.validUntil.getTime() < Date.now())
    return NextResponse.json({ error: "Esse certificado já está vencido." }, { status: 400 });

  const existente = await prisma.certificate.findUnique({
    where: { cnpj: info.cnpj },
    select: { validUntil: true },
  });
  if (existente?.validUntil && info.validUntil.getTime() < existente.validUntil.getTime())
    return NextResponse.json(
      { error: "Já existe um certificado mais recente cadastrado para essa loja." },
      { status: 400 }
    );

  const { encryptedBlob, iv, authTag } = encryptCertificate({ pfxBase64, password: senha });
  const cert = await prisma.certificate.upsert({
    where: { cnpj: info.cnpj },
    create: {
      cnpj: info.cnpj, razaoSocial: info.razaoSocial, fileName: arquivo.name,
      encryptedBlob, iv, authTag, status: "ACTIVE", validUntil: info.validUntil,
    },
    update: {
      fileName: arquivo.name, encryptedBlob, iv, authTag,
      status: "ACTIVE", lastError: null, validUntil: info.validUntil,
    },
  });

  try {
    await inngest.send({ name: "sefaz/certificate.uploaded", data: { certificateId: cert.id } });
  } catch (e: any) {
    console.error("[emissor certificado] Inngest:", e?.message ?? e);
  }
  return NextResponse.json({ ok: true, validUntil: info.validUntil });
}
