import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { b2Put } from "@/lib/b2";
import { guardarDocumento } from "@/lib/docs-storage";
import { identificar } from "@/lib/identificar-doc";
import { TIPOS_DOC } from "@/lib/lojas-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const limpa = (n: string) => n.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Recebe arquivos. Sem tipo/CNPJ informados, identifica pelo nome do arquivo;
 * o que não for identificado vai para a fila (_nao-identificados/) para escolha manual.
 */
export async function POST(req: Request) {
  try {
    const fd = await req.formData();
    const arquivos = fd.getAll("arquivos").filter((x): x is File => typeof x !== "string");
    if (!arquivos.length) return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
    const tipoManual = String(fd.get("tipo") ?? "") || null;
    const cnpjManual = String(fd.get("cnpj") ?? "").replace(/\D/g, "") || null;
    const lojaIdManual = String(fd.get("lojaId") ?? "") || undefined;
    const todos = fd.get("todosCnpjs") === "1";
    const validadeTxt = String(fd.get("validade") ?? "");
    const validade = /^\d{4}-\d{2}-\d{2}$/.test(validadeTxt) ? new Date(validadeTxt + "T12:00:00Z") : null;
    if (tipoManual && !TIPOS_DOC.some((t) => t.id === tipoManual)) {
      return NextResponse.json({ error: "Tipo inválido." }, { status: 400 });
    }

    const lojas = await prisma.lojaCadastro.findMany({
      select: { id: true, loja: true, razaoSocial: true, cnpj: true, ativa: true },
    });

    const resultados: { arquivo: string; status: "guardado" | "pendente" | "erro"; detalhe: string }[] = [];
    for (const f of arquivos) {
      const buffer = Buffer.from(await f.arrayBuffer());
      try {
        const auto = identificar(f.name, lojas);
        const tipo = tipoManual ?? auto.tipo;
        const cnpj = cnpjManual ?? auto.cnpj;
        const tdef = TIPOS_DOC.find((t) => t.id === tipo);
        const pronto = tdef && (tdef.escopo === "LOJA" ? !!lojaIdManual : !!cnpj);
        if (!pronto) {
          await b2Put(`_nao-identificados/${Date.now()}__${limpa(f.name)}`, buffer, f.type || "application/octet-stream");
          resultados.push({ arquivo: f.name, status: "pendente", detalhe: "Não consegui identificar a loja/tipo. Foi para a fila." });
          continue;
        }
        const r = await guardarDocumento({
          buffer, nomeOriginal: f.name, tipo: tipo!, cnpj: cnpj ?? undefined, lojaId: lojaIdManual, validade, todosCnpjsDaEmpresa: todos,
        });
        resultados.push({ arquivo: f.name, status: "guardado", detalhe: r.map((x) => x.nomeArquivo).join(" | ") });
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
