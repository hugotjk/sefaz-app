import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encryptCertificate } from "@/lib/crypto";
import { validarSenhaCertificado } from "@/lib/sefaz";
import { extrairInfoCertificado } from "@/lib/certificate-info";
import { inngest } from "@/lib/inngest";

export const runtime = "nodejs"; // precisa do Node (crypto/forge), não roda em Edge

interface ResultadoArquivo {
  fileName: string;
  ok: boolean;
  cnpj?: string;
  erro?: string;
}

function formatarData(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const senha = formData.get("senha");
  const arquivos = formData.getAll("certificados"); // vários arquivos, mesmo campo

  if (typeof senha !== "string" || senha.length === 0) {
    return NextResponse.json({ error: "Informe a senha dos certificados." }, { status: 400 });
  }
  if (arquivos.length === 0) {
    return NextResponse.json({ error: "Envie ao menos um arquivo .pfx." }, { status: 400 });
  }

  const resultados: ResultadoArquivo[] = [];

  for (const arquivo of arquivos) {
    if (!(arquivo instanceof File)) continue;
    const fileName = arquivo.name;

    try {
      const arrayBuffer = await arquivo.arrayBuffer();
      const pfxBase64 = Buffer.from(arrayBuffer).toString("base64");

      const senhaValida = validarSenhaCertificado(pfxBase64, senha);
      if (!senhaValida) {
        resultados.push({ fileName, ok: false, erro: "SENHA_INCORRETA" });
        continue;
      }

      const info = extrairInfoCertificado(pfxBase64, senha);
      if (!info.cnpj) {
        resultados.push({
          fileName,
          ok: false,
          erro: "Não foi possível identificar o CNPJ no certificado.",
        });
        continue;
      }

      // Não substitui um certificado já cadastrado por uma versão MAIS ANTIGA
      // (validUntil menor) do mesmo CNPJ -- só aceita igual ou mais recente.
      const existente = await prisma.certificate.findUnique({
        where: { cnpj: info.cnpj },
        select: { validUntil: true },
      });
      if (
        existente?.validUntil &&
        info.validUntil &&
        info.validUntil.getTime() < existente.validUntil.getTime()
      ) {
        resultados.push({
          fileName,
          ok: false,
          cnpj: info.cnpj,
          erro: `Já existe um certificado mais recente pra esse CNPJ (vence em ${formatarData(
            existente.validUntil
          )}) -- esse upload foi ignorado por ser mais antigo.`,
        });
        continue;
      }

      const { encryptedBlob, iv, authTag } = encryptCertificate({ pfxBase64, password: senha });

      const certificado = await prisma.certificate.upsert({
        where: { cnpj: info.cnpj },
        create: {
          cnpj: info.cnpj,
          razaoSocial: info.razaoSocial,
          fileName,
          encryptedBlob,
          iv,
          authTag,
          status: "ACTIVE",
          validUntil: info.validUntil,
        },
        update: {
          fileName,
          encryptedBlob,
          iv,
          authTag,
          status: "ACTIVE",
          lastError: null,
          validUntil: info.validUntil,
        },
      });

      await inngest.send({
        name: "sefaz/certificate.uploaded",
        data: { certificateId: certificado.id },
      });

      resultados.push({ fileName, ok: true, cnpj: info.cnpj });
    } catch (err: any) {
      resultados.push({ fileName, ok: false, erro: err?.message ?? "Erro desconhecido." });
    }
  }

  return NextResponse.json({ resultados });
}
