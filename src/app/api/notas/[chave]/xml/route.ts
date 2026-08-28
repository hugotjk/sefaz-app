import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptCertificate } from "@/lib/crypto";
import { consultarPorChave } from "@/lib/sefaz";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { chave: string } }) {
  const nota = await prisma.note.findUnique({
    where: { chaveAcesso: params.chave },
    include: { certificate: true },
  });

  if (!nota) {
    return NextResponse.json({ error: "Nota não encontrada." }, { status: 404 });
  }

  // Já temos o XML completo em cache: retorna direto, sem bater na SEFAZ de novo.
  if (nota.xmlCompleto) {
    return NextResponse.json({ xml: nota.xmlCompleto });
  }

  try {
    const { pfxBase64, password } = decryptCertificate(nota.certificate);
    const pfxBuffer = Buffer.from(pfxBase64, "base64");

    const resultado = await consultarPorChave({
      chaveAcesso: nota.chaveAcesso,
      cnpj: nota.cnpjDestino,
      pfxBuffer,
      senha: password,
    });

    if (!resultado) {
      return NextResponse.json(
        { error: "SEFAZ não retornou o XML completo desta nota (pode ter expirado o prazo de consulta)." },
        { status: 502 }
      );
    }

    await prisma.note.update({
      where: { id: nota.id },
      data: { xmlCompleto: resultado.xmlCompleto },
    });

    return NextResponse.json({ xml: resultado.xmlCompleto });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro ao consultar a SEFAZ." }, { status: 500 });
  }
}
