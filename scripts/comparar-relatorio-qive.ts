/**
 * SOMENTE LEITURA: compara o relatório da Qive/Arquivei (arquivo resumido
 * "qive_notas_90dias.xlsx", na pasta do projeto) com as notas do banco e gera
 * "faltantes_qive.xlsx" com o que falta. Só compara o período que o banco tem
 * (da menor data de emissão do banco até a data do relatório).
 *
 * Uso: npx tsx --env-file=.env scripts\comparar-relatorio-qive.ts
 */
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";

const prisma = new PrismaClient();
const ARQ = "qive_notas_90dias.xlsx";

const dia = (v: unknown) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
};

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ARQ);
  const ws = wb.worksheets[0];
  const cab = (ws.getRow(1).values as unknown[]).slice(1).map(String);
  const col = (n: string) => cab.indexOf(n) + 1;
  const notas: Record<string, unknown>[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const o: Record<string, unknown> = {};
    cab.forEach((n, k) => (o[n] = row.getCell(k + 1).value));
    o["Data Emissão"] = dia(o["Data Emissão"]);
    o["Chave de Acesso"] = String(o["Chave de Acesso"] ?? "").trim();
    notas.push(o);
  });
  void col;
  console.log(`Notas no relatório: ${notas.length}`);

  const min = await prisma.note.aggregate({ _min: { dataEmissao: true } });
  const inicio = min._min.dataEmissao ? min._min.dataEmissao.toISOString().slice(0, 10) : "0000-00-00";
  console.log(`Banco tem notas desde ${inicio}`);

  const noPeriodo = notas.filter((n) => String(n["Data Emissão"]) >= inicio);
  const banco = await prisma.note.findMany({
    where: { chaveAcesso: { in: noPeriodo.map((n) => String(n["Chave de Acesso"])) } },
    select: { chaveAcesso: true },
  });
  const tem = new Set(banco.map((b) => b.chaveAcesso));
  const falta = noPeriodo.filter((n) => !tem.has(String(n["Chave de Acesso"])));
  console.log(`No período: ${noPeriodo.length} | no banco: ${tem.size} | FALTAM: ${falta.length}`);

  const porCnpj = new Map<string, { nome: string; total: number; falta: number }>();
  for (const n of noPeriodo) {
    const k = String(n["CNPJ Destinatário"]);
    const e = porCnpj.get(k) ?? { nome: String(n["Destinatário"] ?? ""), total: 0, falta: 0 };
    e.total++;
    if (!tem.has(String(n["Chave de Acesso"]))) e.falta++;
    porCnpj.set(k, e);
  }

  const out = new ExcelJS.Workbook();
  const a = out.addWorksheet("faltantes");
  a.addRow(cab);
  falta.sort((x, y) => String(x["CNPJ Destinatário"]).localeCompare(String(y["CNPJ Destinatário"])) || String(x["Data Emissão"]).localeCompare(String(y["Data Emissão"])));
  for (const n of falta) a.addRow(cab.map((c) => n[c] ?? ""));
  const b = out.addWorksheet("por_cnpj");
  b.addRow(["CNPJ destinatário", "Destinatário", "Notas no relatório", "Faltam no banco"]);
  [...porCnpj.entries()].sort((x, y) => y[1].falta - x[1].falta).forEach(([k, v]) => b.addRow([k, v.nome, v.total, v.falta]));
  await out.xlsx.writeFile("faltantes_qive.xlsx");
  console.log("Gerado: faltantes_qive.xlsx");
}
main().finally(() => prisma.$disconnect());
