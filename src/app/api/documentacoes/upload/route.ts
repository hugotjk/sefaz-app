import { NextResponse } from "next/server";
import { guardarDocumento } from "@/lib/docs-storage";
import { TIPOS_DOC, soDigitos } from "@/lib/lojas-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Recebe arquivos de UM tipo para UMA loja/CNPJ, sempre escolhidos na mão (clique no chip do documento).
 * Não há identificação automática: tipo e loja/CNPJ vêm do formulário.
 */
export async function POST(req: Request) {
  try {
    const fd = await req.formData();
    const arquivos = fd.getAll("arquivos").filter((x): x is File => typeof x !== "string");
    if (!arquivos.length) return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
    const tipo = String(fd.get("tipo") ?? "");
    const tdef = TIPOS_DOC.find((t) => t.id === tipo);
    if (!tdef) return NextResponse.json({ error: "Escolha o tipo do documento." }, { status: 400 });
    const cnpj = soDigitos(fd.get("cnpj"));
    const lojaId = String(fd.get("lojaId") ?? "") || undefined;
    if (tdef.escopo === "LOJA" ? !lojaId : cnpj.length !== 14) {
      return NextResponse.json({ error: "Informe a loja (CNPJ) que vai receber o documento." }, { status: 400 });
    }
    const todos = fd.get("todosCnpjs") === "1";
    const validadeTxt = String(fd.get("validade") ?? "");
    const validade = /^\d{4}-\d{2}-\d{2}$/.test(validadeTxt) ? new Date(validadeTxt + "T12:00:00Z") : null;

    const resultados: { arquivo: string; status: "guardado" | "repetido" | "erro"; detalhe: string }[] = [];
    for (const f of arquivos) {
      try {
        const r = await guardarDocumento({
          buffer: Buffer.from(await f.arrayBuffer()),
          nomeOriginal: f.name,
          tipo,
          cnpj: cnpj || undefined,
          lojaId,
          validade,
          todosCnpjsDaEmpresa: todos,
        });
        const repetido = r.every((x) => x.jaExistia);
        resultados.push({
          arquivo: f.name,
          status: repetido ? "repetido" : "guardado",
          detalhe: (repetido ? "já estava guardado como " : "") + r.map((x) => x.nomeArquivo).join(" | "),
        });
      } catch (e: any) {
        resultados.push({ arquivo: f.name, status: "erro", detalhe: e?.message ?? "Erro ao guardar." });
      }
    }
    return NextResponse.json({ resultados });
  } catch (e: any) {
    console.error("[documentacoes/upload]", e);
    return NextResponse.json({ error: e?.message ?? "Erro no envio." }, { status: 500 });
  }
}
