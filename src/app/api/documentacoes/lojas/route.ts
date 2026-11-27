import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { nomeComSituacao, normalizarCnpj, raizCnpj, razaoCurta, tipoUnidade } from "@/lib/lojas-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lojas cadastradas + resumo dos documentos já guardados (a tela filtra tudo no navegador). */
export async function GET() {
  try {
    const [lojas, docs] = await Promise.all([
      prisma.lojaDocumentacao.findMany({ orderBy: [{ loja: "asc" }] }),
      prisma.documentoLoja.findMany({ select: { id: true, nomeArquivo: true, escopo: true, chave: true, tipo: true, validade: true } }),
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
        id: d.id,
        nomeArquivo: d.nomeArquivo,
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

const limpa = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

/** Cadastro manual de uma loja (nome, razão social, CNPJ, gestor, rede). Não apaga nem altera as outras. */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const ativa = b.ativa !== false;
    const nome = limpa(b.loja).toUpperCase();
    if (!nome) return NextResponse.json({ error: "Informe o nome da loja." }, { status: 400 });
    const loja = nomeComSituacao(nome, ativa);
    const cnpj = normalizarCnpj(b.cnpj);
    if (!cnpj) return NextResponse.json({ error: "CNPJ inválido: informe os 14 dígitos." }, { status: 400 });
    const criada = await prisma.lojaDocumentacao.create({
      data: {
        cnpj,
        loja,
        razaoSocial: limpa(b.razaoSocial) || null,
        gestor: limpa(b.gestor) || null,
        rede: limpa(b.rede) || null,
        ativa,
        origem: "MANUAL",
      },
    });
    return NextResponse.json({ ok: true, id: criada.id });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "Já existe uma loja com esse nome e esse CNPJ." }, { status: 409 });
    console.error("[documentacoes/lojas POST]", e);
    return NextResponse.json({ error: e?.message ?? "Erro ao cadastrar a loja." }, { status: 500 });
  }
}
