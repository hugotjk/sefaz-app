import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { raizCnpj, razaoCurta, tipoUnidade } from "@/lib/lojas-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lojas cadastradas + resumo dos documentos já guardados (a tela filtra tudo no navegador). */
export async function GET() {
  try {
    const [lojas, docs] = await Promise.all([
      prisma.lojaCadastro.findMany({ orderBy: [{ loja: "asc" }] }),
      prisma.documentoLoja.findMany({ select: { escopo: true, chave: true, tipo: true, validade: true } }),
    ]);
    return NextResponse.json({
      lojas: lojas.map((l) => ({
        id: l.id,
        loja: l.loja,
        razaoSocial: l.razaoSocial,
        razaoCurta: razaoCurta(l.razaoSocial),
        cnpj: l.cnpj,
        raiz: l.cnpj ? raizCnpj(l.cnpj) : "",
        unidade: tipoUnidade(l.cnpj),
        gestor: l.gestor,
        rede: l.rede,
        ativa: l.ativa,
        origem: l.origem,
      })),
      docs: docs.map((d) => ({
        escopo: d.escopo,
        chave: d.chave,
        tipo: d.tipo,
        validade: d.validade ? d.validade.toISOString() : null,
      })),
    });
  } catch (e: any) {
    console.error("[documentacoes/lojas]", e);
    return NextResponse.json({ error: e?.message ?? "Erro ao carregar as lojas." }, { status: 500 });
  }
}
