import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { statusCertificado } from "@/lib/emissor-certificado-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const lojas = await prisma.emissorLoja.findMany({ orderBy: { razaoSocial: "asc" } });
  const cnpjs = lojas.map((l) => l.cnpj);
  const [certs, refs] = await Promise.all([
    prisma.certificate.findMany({
      where: { cnpj: { in: cnpjs } },
      select: { cnpj: true, status: true, validUntil: true },
    }),
    prisma.lojaReferencia.findMany({
      where: { cnpj: { in: cnpjs } },
      select: { cnpj: true, loja: true },
    }),
  ]);
  const certPorCnpj = new Map(certs.map((c) => [c.cnpj, c]));
  const nomePorCnpj = new Map(refs.map((r) => [r.cnpj, r.loja]));

  return NextResponse.json({
    lojas: lojas.map((l) => ({
      ...l,
      loja: nomePorCnpj.get(l.cnpj) ?? null,
      certificado: {
        ...statusCertificado(certPorCnpj.get(l.cnpj)),
        validUntil: certPorCnpj.get(l.cnpj)?.validUntil ?? null,
      },
    })),
  });
}
