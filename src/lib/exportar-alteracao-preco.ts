import ExcelJS from "exceljs";
import { montarConferenciaMkp, type FiltrosConferenciaMkp, type LinhaMkp } from "@/lib/conferencia-mkp";
import { COLUNAS_ALTERACAO, REDE_MULTI, formulasDaLinha } from "@/lib/alteracao-formulas";
import { parseChaves } from "@/lib/exportar-cadastro-produtos";

/**
 * Planilha de ALTERAÇÃO DE CADASTRO (padrão do modelo do Hugo): a coluna A é o código do produto no PDV
 * (rede MULTI) e o resto vem das fórmulas dbsleek (mantidas exatamente como no modelo). Só os preços
 * 1 a 4 são preenchidos pelo app; o que não se sabe fica vazio em amarelo.
 */


export interface ResumoAlteracao {
  linhas: number;
  semPreco3: number;
  semCodigoPdv: string[]; // referências sem produto na rede MULTI
}

export async function gerarAlteracaoPrecoXlsx(
  chaves: unknown,
  filtros: FiltrosConferenciaMkp
): Promise<{ buffer: Buffer; resumo: ResumoAlteracao }> {
  const pares = parseChaves(chaves);
  const alvo = new Set(pares.map((p) => `${(p.modelo ?? "").toUpperCase()}|${(p.referencia ?? "").toUpperCase()}`));
  const res = await montarConferenciaMkp({ ...filtros, somenteAlerta: false });
  const sel: LinhaMkp[] = res.linhas.filter(
    (l) => l.redeId === REDE_MULTI && alvo.has(`${l.modelo.toUpperCase()}|${l.referencia.toUpperCase()}`)
  );
  sel.sort((a, b) => a.modelo.localeCompare(b.modelo, "pt-BR") || a.referencia.localeCompare(b.referencia, "pt-BR"));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet");
  ws.addRow(COLUNAS_ALTERACAO).font = { bold: true };
  const amarelo = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2A8" } } as const;
  const resumo: ResumoAlteracao = { linhas: 0, semPreco3: 0, semCodigoPdv: [] };

  for (const l of sel) {
    if (l.produtosPdv.length === 0) {
      resumo.semCodigoPdv.push(`${l.modelo} ${l.referencia}`);
      continue;
    }
    if (l.precoCorreto == null) resumo.semPreco3++;
    for (const prod of [...l.produtosPdv].sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }))) {
      const row = ws.addRow([]);
      const n = row.number;
      const a = row.getCell(1);
      a.value = prod.codigo;
      a.fill = amarelo as any;
      const fx = formulasDaLinha(n);
      for (const [col, x] of Object.entries(fx)) {
        const c = row.getCell(Number(col));
        c.numFmt = "General";
        c.value = x.array ? ({ formula: x.f, shareType: "array", ref: `${c.address}` } as any) : ({ formula: x.f } as any);
      }
      row.getCell(9).value = "PC";
      const tabelas: [number, number][] = [[13, 1], [15, 2], [17, 3], [19, 7], [21, 9]];
      for (const [col, t] of tabelas) row.getCell(col).value = t;
      row.getCell(22).value = 0; // Preco5
      const precos: [number, number | null][] = [[14, l.custoBruto], [16, l.custoTotal], [18, l.precoCorreto], [20, l.preco4]];
      for (const [col, v] of precos) {
        const c = row.getCell(col);
        if (v == null) c.fill = amarelo as any;
        else {
          c.value = v;
          c.numFmt = "0.00";
        }
      }
      resumo.linhas++;
    }
  }
  ws.columns.forEach((c, i) => (c.width = i === 0 ? 11 : 14));
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), resumo };
}

export function nomeArquivoAlteracao(d = new Date()): string {
  const p = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const hh = g("hour") === "24" ? "00" : g("hour");
  return `ALTERACAO_PRECO_${g("day")}_${g("month")}_${g("year")}__${hh}_${g("minute")}.xlsx`;
}
