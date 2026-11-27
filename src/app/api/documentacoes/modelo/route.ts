import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Modelo da planilha de lojas (mesmas colunas que a importação lê). */
export async function GET() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("LOJAS");
  const colunas = [
    { header: "STATUS_LOJA", key: "status", width: 14 },
    { header: "LOJA", key: "loja", width: 30 },
    { header: "RAZAO_SOCIAL", key: "razao", width: 48 },
    { header: "CNPJ", key: "cnpj", width: 22 },
    { header: "GESTOR", key: "gestor", width: 20 },
    { header: "REDE", key: "rede", width: 16 },
  ];
  ws.columns = colunas;
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.getColumn("cnpj").numFmt = "@"; // texto: o Excel não come os zeros da esquerda
  for (let r = 2; r <= 1000; r++) {
    ws.getCell(`A${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"ATIVA,INATIVA"'] };
    ws.getCell(`D${r}`).numFmt = "@";
  }

  const ins = wb.addWorksheet("COMO PREENCHER");
  ins.columns = [{ width: 110 }];
  [
    "Preencha a aba LOJAS, uma loja por linha, e importe em Documentações > Importar planilha de lojas.",
    "STATUS_LOJA: ATIVA ou INATIVA. Só as lojas ATIVAS entram na busca de notas do Qive.",
    "LOJA: nome da loja como vocês usam (duas lojas com o mesmo CNPJ e nomes diferentes são lojas diferentes).",
    "CNPJ: 14 dígitos, com ou sem pontuação (ex.: 12.345.678/0001-90). Obrigatório.",
    "RAZAO_SOCIAL, GESTOR e REDE: opcionais.",
    "Lojas que já existem (mesmo CNPJ e mesmo nome) são atualizadas; nada é apagado.",
    "Lojas com NRN no nome da loja são ignoradas pela importação.",
  ].forEach((t) => ins.addRow([t]));

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename*=UTF-8''MODELO_LOJAS.xlsx",
    },
  });
}
