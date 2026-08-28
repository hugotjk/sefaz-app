import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { inngest } from "@/lib/inngest";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const certificado = await prisma.certificate.findUnique({ where: { id: params.id } });

  if (!certificado) {
    return NextResponse.json({ error: "Certificado não encontrado." }, { status: 404 });
  }
  if (certificado.status !== "ACTIVE") {
    return NextResponse.json(
      { error: `Certificado está com status ${certificado.status}, não é possível sincronizar.` },
      { status: 400 }
    );
  }

  await inngest.send({
    name: "sefaz/certificate.sync",
    data: { certificateId: certificado.id },
  });

  return NextResponse.json({ ok: true });
}
