import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { raizCnpj, razaoCurta, tipoUnidade } from "@/lib/lojas-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const l = await prisma.lojaCadastro.findUnique({ where: { id: params.id } });
  if (!l) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });
  const [mesmoCnpj, docs] = await Promise.all([
    l.cnpj ? prisma.lojaCadastro.findMany({ where: { cnpj: l.cnpj, id: { not: l.id } }, select: { id: true, loja: true, ativa: true } }) : [],
    prisma.documentoLoja.findMany({
      where: { OR: [{ escopo: "CNPJ", chave: l.cnpj || "-" }, { escopo: "LOJA", chave: l.id }] },
      orderBy: { enviadoEm: "desc" },
    }),
  ]);
  const irmaos = l.cnpj ? await prisma.lojaCadastro.count({ where: { cnpj: { startsWith: raizCnpj(l.cnpj) } } }) : 0;
  return NextResponse.json({
    loja: { ...l, razaoCurta: razaoCurta(l.razaoSocial), unidade: tipoUnidade(l.cnpj), raiz: l.cnpj ? raizCnpj(l.cnpj) : "" },
    mesmoCnpj,
    cnpjsDaEmpresa: irmaos,
    docs: docs.map((d) => ({
      id: d.id, tipo: d.tipo, nomeArquivo: d.nomeArquivo, tamanho: d.tamanho,
      validade: d.validade?.toISOString() ?? null, enviadoEm: d.enviadoEm.toISOString(),
    })),
  });
}
