import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const certificados = await prisma.certificate.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      cnpj: true,
      razaoSocial: true,
      status: true,
      lastError: true,
      backfillDone: true,
      validUntil: true,
      createdAt: true,
      _count: { select: { notes: true } },
    },
  });

  return NextResponse.json({ certificados });
}
