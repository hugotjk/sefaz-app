import { prisma } from "@/lib/db";
import { encryptCertificate } from "@/lib/crypto";
import { validarSenhaCertificado } from "@/lib/sefaz";
import { extrairInfoCertificado } from "@/lib/certificate-info";
import { inngest } from "@/lib/inngest";

/** Confere senha, CNPJ e validade do .pfx. Lança Error com mensagem para o usuário. */
export async function conferirCertificado(pfxBase64: string, senha: string, cnpj: string) {
  if (!validarSenhaCertificado(pfxBase64, senha)) throw new Error("Senha incorreta.");
  let info;
  try {
    info = extrairInfoCertificado(pfxBase64, senha);
  } catch (e: any) {
    throw new Error(e?.message ?? "Certificado ilegível.");
  }
  if (info.cnpj !== cnpj)
    throw new Error(`Esse certificado é do CNPJ ${info.cnpj || "desconhecido"}, não da loja ${cnpj}.`);
  if (info.validUntil.getTime() < Date.now()) throw new Error("Esse certificado já está vencido.");
  const existente = await prisma.certificate.findUnique({ where: { cnpj: info.cnpj }, select: { validUntil: true } });
  if (existente?.validUntil && info.validUntil.getTime() < existente.validUntil.getTime())
    throw new Error("Já existe um certificado mais recente cadastrado para essa loja.");
  return info;
}

/** Confere e grava (criptografado) o certificado da loja. */
export async function salvarCertificadoLoja(cnpj: string, fileName: string, pfxBase64: string, senha: string) {
  const info = await conferirCertificado(pfxBase64, senha, cnpj);
  const { encryptedBlob, iv, authTag } = encryptCertificate({ pfxBase64, password: senha });
  const cert = await prisma.certificate.upsert({
    where: { cnpj: info.cnpj },
    create: {
      cnpj: info.cnpj, razaoSocial: info.razaoSocial, fileName,
      encryptedBlob, iv, authTag, status: "ACTIVE", validUntil: info.validUntil,
    },
    update: { fileName, encryptedBlob, iv, authTag, status: "ACTIVE", lastError: null, validUntil: info.validUntil },
  });
  try {
    await inngest.send({ name: "sefaz/certificate.uploaded", data: { certificateId: cert.id } });
  } catch (e: any) {
    console.error("[emissor certificado] Inngest:", e?.message ?? e);
  }
  return info;
}
