import { NextRequest, NextResponse } from "next/server";
import { montarConferenciaMkp, parseFiltrosConferenciaMkp, type StatusMkp } from "@/lib/conferencia-mkp";
import { REDE_MULTI } from "@/lib/alteracao-formulas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALERTAS: StatusMkp[] = ["ERRO", "PRECOS_DIVERGENTES", "SEM_PRECO_PDV"];

// Produtos já cadastrados na MULTI cujo preço precisa de alteração (ou todos, com ?todos=1),
// agrupados por modelo. A chave de cada item é JSON([modelo, referência]).
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const todos = sp.get("todos") === "1";
    const res = await montarConferenciaMkp({ ...parseFiltrosConferenciaMkp(sp), rede: "", somenteAlerta: false });
    const grupos = new Map<string, any[]>();
    for (const l of res.linhas) {
      if (l.redeId !== REDE_MULTI || l.produtosPdv.length === 0) continue;
      if (!todos && !ALERTAS.includes(l.status)) continue;
      const lista = grupos.get(l.modelo) ?? [];
      lista.push({
        chave: JSON.stringify([l.modelo, l.referencia]),
        referencia: l.referencia,
        descricao: l.descricao,
        status: l.status,
        precoPdv: l.precoPdv,
        precoCorreto: l.precoCorreto,
        custoBruto: l.custoBruto,
        custoTotal: l.custoTotal,
        preco4: l.preco4,
        nProdutos: l.produtosPdv.length,
      });
      grupos.set(l.modelo, lista);
    }
    const out = [...grupos.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
      .map(([modelo, itens]) => ({ modelo, itens }));
    return NextResponse.json({
      grupos: out,
      totalModelos: out.length,
      totalReferencias: out.reduce((s, g) => s + g.itens.length, 0),
    });
  } catch (err: any) {
    console.error("[alteracao-preco]", err);
    return NextResponse.json({ error: err?.message ?? "Erro ao montar o relatório." }, { status: 500 });
  }
}
