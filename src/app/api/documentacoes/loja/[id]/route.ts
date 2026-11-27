import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { nomeComSituacao, raizCnpj, razaoCurta, tipoUnidade } from "@/lib/lojas-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const l = await prisma.lojaDocumentacao.findUnique({ where: { id: params.id } });
  if (!l) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });
  const [mesmoCnpj, docs] = await Promise.all([
    l.cnpj ? prisma.lojaDocumentacao.findMany({ where: { cnpj: l.cnpj, id: { not: l.id } }, select: { id: true, loja: true, ativa: true } }) : [],
    prisma.documentoLoja.findMany({
      where: { OR: [{ escopo: "CNPJ", chave: l.cnpj || "-" }, { escopo: "LOJA", chave: l.id }] },
      orderBy: { enviadoEm: "desc" },
    }),
  ]);
  const irmaos = l.cnpj ? await prisma.lojaDocumentacao.count({ where: { cnpj: { startsWith: raizCnpj(l.cnpj) } } }) : 0;
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

const limpa = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

/** Edita nome, razão social, gestor, rede e situação. O CNPJ não muda aqui (os documentos são guardados por CNPJ). */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const b = await req.json();
    const ativa = b.ativa !== false;
    const nome = limpa(b.loja).toUpperCase();
    if (!nome) return NextResponse.json({ error: "Informe o nome da loja." }, { status: 400 });
    // inativa -> o nome ganha " INATIVA" no fim; reativada -> o sufixo sai
    const loja = nomeComSituacao(nome, ativa);
    const atual = await prisma.lojaDocumentacao.findUnique({ where: { id: params.id } });
    if (!atual) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });
    await prisma.lojaDocumentacao.update({
      where: { id: params.id },
      data: {
        loja,
        razaoSocial: limpa(b.razaoSocial) || null,
        gestor: limpa(b.gestor) || null,
        rede: limpa(b.rede) || null,
        ativa,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "Já existe uma loja com esse nome e esse CNPJ." }, { status: 409 });
    console.error("[documentacoes/loja PUT]", e);
    return NextResponse.json({ error: e?.message ?? "Erro ao salvar a loja." }, { status: 500 });
  }
}
