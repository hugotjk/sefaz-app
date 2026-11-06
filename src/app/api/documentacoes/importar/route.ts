import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { lojaEhNrn, normalizarCnpj } from "@/lib/lojas-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const texto = (v: any): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("text" in v) return String((v as any).text ?? "").trim();
    if ("result" in v) return String((v as any).result ?? "").trim();
    if ("richText" in v) return (v as any).richText.map((p: any) => p.text).join("").trim();
  }
  return String(v).trim();
};

interface Linha {
  cnpj: string;
  loja: string;
  razao: string;
  gestor: string;
  rede: string;
  ativa: boolean;
}

/**
 * Importa uma planilha LOJAS ou LOJAS_MFPLAI (xlsx). Lê só: status, loja, razão social, CNPJ, gestor e rede.
 * Lojas com NRN no NOME da loja ficam de fora. Linhas existentes são atualizadas, nada é apagado.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const arq = form.get("arquivo");
    if (!(arq instanceof File)) return NextResponse.json({ error: "Envie o arquivo .xlsx." }, { status: 400 });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await arq.arrayBuffer()) as any);
    const ws = wb.worksheets[0];
    if (!ws) return NextResponse.json({ error: "A planilha está vazia." }, { status: 400 });

    // Acha a linha de cabeçalho (a que tem STATUS_LOJA e LOJA).
    let cab = 0;
    let colunas: Record<string, number> = {};
    for (let r = 1; r <= Math.min(10, ws.rowCount) && !cab; r++) {
      const m: Record<string, number> = {};
      ws.getRow(r).eachCell({ includeEmpty: false }, (c, n) => {
        m[texto(c.value).toUpperCase()] = n;
      });
      if (m["STATUS_LOJA"] && m["LOJA"]) {
        cab = r;
        colunas = m;
      }
    }
    if (!cab) {
      return NextResponse.json({ error: "Não achei as colunas STATUS_LOJA e LOJA. É a planilha LOJAS ou LOJAS_MFPLAI?" }, { status: 400 });
    }
    const origem = colunas["REPRESENTANTE"] ? "MFPLAI" : "LOJAS";
    const col = (nome: string) => colunas[nome] ?? 0;

    const linhas = new Map<string, Linha>();
    let ignoradasNrn = 0;
    let semCnpj = 0;
    let lidas = 0;
    for (let r = cab + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const loja = texto(row.getCell(col("LOJA")).value).replace(/\s+/g, " ").toUpperCase();
      if (!loja) continue;
      lidas++;
      if (lojaEhNrn(loja)) {
        ignoradasNrn++;
        continue;
      }
      const status = texto(row.getCell(col("STATUS_LOJA")).value).toUpperCase();
      const cnpj = normalizarCnpj(col("CNPJ") ? row.getCell(col("CNPJ")).value : "");
      if (!cnpj) semCnpj++;
      const l: Linha = {
        cnpj,
        loja,
        razao: col("RAZAO_SOCIAL") ? texto(row.getCell(col("RAZAO_SOCIAL")).value) : "",
        gestor: col("GESTOR") ? texto(row.getCell(col("GESTOR")).value) : "",
        rede: col("REDE") ? texto(row.getCell(col("REDE")).value) : "",
        ativa: status.startsWith("ATIV"),
      };
      linhas.set(`${cnpj}|${loja}`, l);
    }
    const lista = [...linhas.values()];
    if (!lista.length) return NextResponse.json({ error: "Nenhuma loja válida na planilha." }, { status: 400 });

    let novas = 0;
    let atualizadas = 0;
    for (let i = 0; i < lista.length; i += 200) {
      const f = lista.slice(i, i + 200);
      const res = await prisma.$queryRaw<{ inserida: boolean }[]>(Prisma.sql`
        INSERT INTO "LojaCadastro" (id, cnpj, loja, "razaoSocial", gestor, rede, ativa, origem, "updatedAt")
        SELECT t.id, t.cnpj, t.loja, NULLIF(t.razao, ''), NULLIF(t.gestor, ''), NULLIF(t.rede, ''), t.ativa, ${origem}::text, NOW()
        FROM unnest(${f.map(() => randomUUID())}::text[], ${f.map((x) => x.cnpj)}::text[], ${f.map((x) => x.loja)}::text[],
          ${f.map((x) => x.razao)}::text[], ${f.map((x) => x.gestor)}::text[], ${f.map((x) => x.rede)}::text[],
          ${f.map((x) => x.ativa)}::boolean[]) AS t(id, cnpj, loja, razao, gestor, rede, ativa)
        ON CONFLICT (cnpj, loja) DO UPDATE SET
          "razaoSocial" = COALESCE(EXCLUDED."razaoSocial", "LojaCadastro"."razaoSocial"),
          gestor = COALESCE(EXCLUDED.gestor, "LojaCadastro".gestor),
          rede = COALESCE(EXCLUDED.rede, "LojaCadastro".rede),
          ativa = EXCLUDED.ativa, origem = EXCLUDED.origem, "updatedAt" = NOW()
        RETURNING (xmax = 0) AS inserida
      `);
      for (const x of res) x.inserida ? novas++ : atualizadas++;
    }

    // Avisos: mesmo CNPJ ativo em mais de uma loja (pode ser loja provisória).
    const ativosPorCnpj = new Map<string, string[]>();
    for (const l of lista) if (l.ativa && l.cnpj) ativosPorCnpj.set(l.cnpj, [...(ativosPorCnpj.get(l.cnpj) ?? []), l.loja]);
    const cnpjRepetido = [...ativosPorCnpj.entries()].filter(([, v]) => v.length > 1).map(([cnpj, lojas]) => ({ cnpj, lojas }));

    return NextResponse.json({ origem, lidas, importadas: lista.length, novas, atualizadas, ignoradasNrn, semCnpj, cnpjRepetido });
  } catch (e: any) {
    console.error("[documentacoes/importar]", e);
    return NextResponse.json({ error: e?.message ?? "Erro ao importar a planilha." }, { status: 500 });
  }
}
