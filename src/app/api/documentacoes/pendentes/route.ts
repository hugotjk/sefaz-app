import { NextResponse } from "next/server";
import { b2Delete, b2Get, b2List } from "@/lib/b2";
import { guardarDocumento } from "@/lib/docs-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREFIXO = "_nao-identificados/";
const nomeDe = (key: string) => key.slice(PREFIXO.length).replace(/^\d+__/, "");

export async function GET() {
  try {
    const itens = await b2List(PREFIXO);
    return NextResponse.json({
      pendentes: itens
        .filter((i) => i.key !== PREFIXO)
        .map((i) => ({ key: i.key, nome: nomeDe(i.key), tamanho: i.size, em: i.modificado?.toISOString() ?? null })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro ao listar a fila." }, { status: 500 });
  }
}

/** Atribui um arquivo da fila a um tipo e CNPJ/loja (e o remove da fila). */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const key = String(b.key ?? "");
    if (!key.startsWith(PREFIXO)) return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });
    const buffer = await b2Get(key);
    const validade = /^\d{4}-\d{2}-\d{2}$/.test(b.validade ?? "") ? new Date(b.validade + "T12:00:00Z") : null;
    const r = await guardarDocumento({
      buffer, nomeOriginal: nomeDe(key), tipo: String(b.tipo ?? ""), cnpj: b.cnpj ? String(b.cnpj).replace(/\D/g, "") : undefined,
      lojaId: b.lojaId || undefined, validade, todosCnpjsDaEmpresa: !!b.todosCnpjs,
    });
    await b2Delete(key);
    return NextResponse.json({ ok: true, guardados: r.map((x) => x.nomeArquivo) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro ao guardar." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!key.startsWith(PREFIXO)) return NextResponse.json({ error: "Arquivo inválido." }, { status: 400 });
  await b2Delete(key);
  return NextResponse.json({ ok: true });
}
