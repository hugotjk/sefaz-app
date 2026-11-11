import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const r = await prisma.emissaoRascunho.findUnique({ where: { id: params.id } });
  if (!r) return NextResponse.json({ error: "Rascunho não encontrado." }, { status: 404 });
  return NextResponse.json({ rascunho: r });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await prisma.emissaoRascunho.deleteMany({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
