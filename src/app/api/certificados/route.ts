import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const certificados = await prisma.certificate.findMany({
    // Decrescente por validade: dentro dos vencidos, quem venceu mais
    // recentemente fica no topo; dentro dos válidos, o mesmo critério (quem
    // vence mais tarde fica no topo). Como consequência os ACTIVE (validade no
    // futuro) naturalmente ficam acima dos EXPIRED (validade no passado) numa
    // única ordenação — sem precisar de um segundo critério por status.
    orderBy: { validUntil: { sort: "desc", nulls: "last" } },
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
