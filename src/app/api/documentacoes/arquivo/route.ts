import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { b2Delete, b2Get, contentTypePorNome } from "@/lib/b2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function achar(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return prisma.documentoLoja.findUnique({ where: { id } });
}

export async function GET(req: Request) {
  const d = await achar(req);
  if (!d?.driveItemId) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  const inline = new URL(req.url).searchParams.get("ver") === "1";
  const buf = await b2Get(d.driveItemId);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentTypePorNome(d.nomeArquivo),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(d.nomeArquivo)}`,
    },
  });
}

export async function DELETE(req: Request) {
  const d = await achar(req);
  if (!d) return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
  if (d.driveItemId) await b2Delete(d.driveItemId);
  await prisma.documentoLoja.delete({ where: { id: d.id } });
  return NextResponse.json({ ok: true });
}
