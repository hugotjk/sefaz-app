import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { decryptCertificate } from "@/lib/crypto";
import { consultarPorChave } from "@/lib/sefaz";
import { parseNFeXml } from "@/lib/parse-nfe-xml";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    if ("erro" in resultado) {
      return NextResponse.json(
        {
          error: `SEFAZ não retornou o XML completo desta nota. Motivo (cStat ${resultado.statusCode}): ${resultado.erro}`,
        },
        { status: 502 }
      );
    }

    // Aproveita pra completar os dados que a consulta resumida não trazia
    // (número, série), assim a lista de notas fica correta depois disso.
    const nfe = parseNFeXml(resultado.xmlCompleto);

    await prisma.note.update({
      where: { id: nota.id },
      data: {
        xmlCompleto: resultado.xmlCompleto,
        numero: nfe.numero || nota.numero,
        serie: nfe.serie || nota.serie,
      },
    });

    return NextResponse.json({ xml: resultado.xmlCompleto });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Erro ao consultar a SEFAZ." }, { status: 500 });
  }
}
