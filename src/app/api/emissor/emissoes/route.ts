import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { LISTA } from "@/lib/emissor-envio";

export const dynamic = "force-dynamic";

export async function GET() {
  const emissoes = await prisma.emissaoNfe.findMany({ orderBy: { createdAt: "desc" }, take: 200, select: LISTA });
  const refs = await prisma.emissorLoja.findMany({
    where: { cnpj: { in: Array.from(new Set(emissoes.map((e) => e.lojaCnpj))) } },
    select: { cnpj: true, razaoSocial: true },
  });
  const nome = new Map(refs.map((r) => [r.cnpj, r.razaoSocial]));
  return NextResponse.json({ emissoes: emissoes.map((e) => ({ ...e, loja: nome.get(e.lojaCnpj) ?? e.lojaCnpj })) });
}
