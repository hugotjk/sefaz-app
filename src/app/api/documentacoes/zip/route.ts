import { NextResponse } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { b2Get } from "@/lib/b2";
import { nomePastaCnpj } from "@/lib/lojas-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** ZIP com todos os documentos de um CNPJ (cartão, IE, certificado, alvará, contrato e fotos das lojas desse CNPJ). */
export async function GET(req: Request) {
  const cnpj = (new URL(req.url).searchParams.get("cnpj") ?? "").replace(/\D/g, "");
  if (cnpj.length !== 14) return NextResponse.json({ error: "CNPJ inválido." }, { status: 400 });
  const lojas = await prisma.lojaCadastro.findMany({ where: { cnpj } });
  const razao = lojas.find((l) => l.razaoSocial)?.razaoSocial ?? null;
  const docs = await prisma.documentoLoja.findMany({
    where: { OR: [{ escopo: "CNPJ", chave: cnpj }, { escopo: "LOJA", chave: { in: lojas.map((l) => l.id) } }] },
  });
  if (!docs.length) return NextResponse.json({ error: "Nenhum documento guardado para este CNPJ." }, { status: 404 });
  const zip = new JSZip();
  for (const d of docs) {
    if (!d.driveItemId) continue;
    zip.file(d.nomeArquivo, await b2Get(d.driveItemId));
  }
  const buf = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const nome = `${nomePastaCnpj(cnpj, razao)}.zip`;
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(nome)}` },
  });
}
