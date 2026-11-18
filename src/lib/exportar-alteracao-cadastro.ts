import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COLUNAS_ALTERACAO, REDE_MULTI, formulasDaLinha } from "@/lib/alteracao-formulas";
import { parseChaves } from "@/lib/exportar-cadastro-produtos";
import { idApiDoProduto } from "@/lib/produto-id";

/**
 * Planilha de ALTERAÇÃO DE CADASTRO (padrão novo): só a coluna A (Referencia = código do produto no
 * PDV, rede MULTI — NÃO a referência do fornecedor da nota) é preenchida pelo app. O resto são as
 * fórmulas dbsleek do modelo, que buscam tudo no PDV ao abrir no Excel.
 */

export interface ResumoAlteracaoCadastro {
  linhas: number;
  semProdutoPdv: string[]; // "MODELO REFERENCIA" sem produto na rede MULTI
}

const MOSTRA = (campo: string, n: number) =>
  `_xll.dbsleek("MOSTRA","DBASE.BIN","PRODUTOS","${campo}","REFERENCIA","=",$A${n},"REDE","=","MULTI")`;

export async function gerarAlteracaoCadastroXlsx(
  chaves: unknown
): Promise<{ buffer: Buffer; resumo: ResumoAlteracaoCadastro }> {
  const pares = parseChaves(chaves).filter((p) => p.modelo && p.referencia);
  const resumo: ResumoAlteracaoCadastro = { linhas: 0, semProdutoPdv: [] };

  const codigos = new Map<string, string[]>(); // "MOD|REF" -> códigos PDV
  if (pares.length) {
    const mods = pares.map((p) => p.modelo!.trim().toUpperCase());
    const refs = pares.map((p) => p.referencia!.trim().toUpperCase());
    const rows = await prisma.$queryRaw<{ id: string; mod_u: string; ref_u: string }[]>(Prisma.sql`
      SELECT p.id, upper(trim(p."modeloNome")) AS mod_u, upper(trim(p."referenciaFornecedor")) AS ref_u
        FROM "Produto" p
        JOIN unnest(${mods}::text[], ${refs}::text[]) AS c(m, r)
          ON upper(trim(p."modeloNome")) = c.m AND upper(trim(p."referenciaFornecedor")) = c.r
       WHERE p."redeId" = ${REDE_MULTI}`);
    for (const r of rows) {
      const k = `${r.mod_u}|${r.ref_u}`;
      const l = codigos.get(k) ?? [];
      l.push(idApiDoProduto(r.id));
      codigos.set(k, l);
    }
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet");
  ws.addRow(COLUNAS_ALTERACAO).font = { bold: true };

  const ordenados = [...pares].sort(
    (a, b) => a.modelo!.localeCompare(b.modelo!, "pt-BR") || a.referencia!.localeCompare(b.referencia!, "pt-BR")
  );
  const vistos = new Set<string>();
  for (const p of ordenados) {
    const k = `${p.modelo!.trim().toUpperCase()}|${p.referencia!.trim().toUpperCase()}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    const lista = codigos.get(k);
    if (!lista?.length) {
      resumo.semProdutoPdv.push(`${p.modelo} ${p.referencia}`);
      continue;
    }
    for (const codigo of [...new Set(lista)].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))) {
      const row = ws.addRow([]);
      const n = row.number;
      row.getCell(1).value = codigo;
      const fx = formulasDaLinha(n);
      // Colunas de preço e NCM como no modelo.
      fx[14] = { f: MOSTRA("CUSTO_TOTAL", n), array: true };
      fx[16] = { f: MOSTRA("CUSTO_BRUTO", n), array: true };
      fx[18] = { f: MOSTRA("PRECO_VAREJO", n), array: true };
      fx[20] = { f: MOSTRA("PRECO_VAREJO_OFFRIO", n), array: true };
      fx[23] = { f: `TRIM(${MOSTRA("NCM", n).replace('"NCM"', "W$1")})`, array: true };
      for (const [col, x] of Object.entries(fx)) {
        const c = row.getCell(Number(col));
        c.numFmt = "General";
        c.value = x.array ? ({ formula: x.f, shareType: "array", ref: `${c.address}` } as any) : ({ formula: x.f } as any);
      }
      row.getCell(9).value = "PC";
      const tabelas: [number, number][] = [[13, 1], [15, 2], [17, 3], [19, 7], [21, 9]];
      for (const [col, t] of tabelas) row.getCell(col).value = t;
      row.getCell(22).value = 0; // Preco5
      resumo.linhas++;
    }
  }
  ws.columns.forEach((c, i) => (c.width = i === 0 ? 11 : 14));
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), resumo };
}

export function nomeArquivoAlteracaoCadastro(d = new Date()): string {
  const p = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const hh = g("hour") === "24" ? "00" : g("hour");
  return `ALTERACAO_DE_CADASTRO_${g("day")}_${g("month")}_${g("year")}__${hh}_${g("minute")}.xlsx`;
}
