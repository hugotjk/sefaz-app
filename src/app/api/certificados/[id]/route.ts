import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Pausa/retoma a consulta de notas na SEFAZ para este certificado (não apaga nada). */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { consultaAtiva } = await req.json().catch(() => ({}));
  if (typeof consultaAtiva !== "boolean") return NextResponse.json({ error: "Valor inválido." }, { status: 400 });
  const c = await prisma.certificate.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!c) return NextResponse.json({ error: "Certificado não encontrado." }, { status: 404 });
  await prisma.certificate.update({ where: { id: params.id }, data: { consultaAtiva } });
  return NextResponse.json({ ok: true });
}
