import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export interface LojaSemCertificado {
  cnpj: string;
  loja: string | null;
  razaoSocial: string | null;
  statusLoja: string | null;
  rede: string | null;
  notas: number;
}

/**
 * CNPJs destinatários de notas SEM certificado associado (`Note.certificateId
 * IS NULL` — hoje só acontece em notas importadas do histórico da Qive, ver
 * src/lib/qive.ts), cruzados com `LojaReferencia` pra mostrar nome da loja.
 * Ajuda o cliente a decidir pra quais CNPJs vale a pena providenciar
 * certificado digital. Ordenado do maior pro menor volume de notas.
 */
export async function GET() {
  const porCnpj = await prisma.$queryRaw<{ cnpjDestino: string; notas: number }[]>(Prisma.sql`
    SELECT "cnpjDestino", COUNT(*)::int AS notas
    FROM "Note"
    WHERE "certificateId" IS NULL
    GROUP BY "cnpjDestino"
    ORDER BY notas DESC, "cnpjDestino" ASC
  `);

  const cnpjs = porCnpj.map((r) => r.cnpjDestino);
  const lojas = cnpjs.length
    ? await prisma.lojaReferencia.findMany({
        where: { cnpj: { in: cnpjs } },
        select: { cnpj: true, loja: true, razaoSocial: true, status: true, rede: true },
      })
    : [];
  const lojaPorCnpj = new Map(lojas.map((l) => [l.cnpj, l]));

  const resultado: LojaSemCertificado[] = porCnpj.map((r) => {
    const l = lojaPorCnpj.get(r.cnpjDestino);
    return {
      cnpj: r.cnpjDestino,
      loja: l?.loja ?? null,
      razaoSocial: l?.razaoSocial ?? null,
      statusLoja: l?.status ?? null,
      rede: l?.rede ?? null,
      notas: Number(r.notas),
    };
  });

  return NextResponse.json({ lojas: resultado, total: resultado.length });
}
