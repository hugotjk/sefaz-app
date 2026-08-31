import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { inngest } from "@/lib/inngest";

export async function POST() {
  const certificados = await prisma.certificate.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
  });

  if (certificados.length === 0) {
    return NextResponse.json({ disparados: 0 });
  }

  await inngest.send(
    certificados.map((c: { id: string }) => ({
      name: "sefaz/certificate.sync" as const,
      data: { certificateId: c.id },
    }))
  );

  return NextResponse.json({ disparados: certificados.length });
}
