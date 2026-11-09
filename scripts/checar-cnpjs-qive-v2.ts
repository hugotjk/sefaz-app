/**
 * Confere, CNPJ a CNPJ, o que a API v2 da Qive (POST /v2/dfe/nfe) devolve — SOMENTE LEITURA.
 * Lê a planilha cnpjs_para_qive.xlsx (coluna A = CNPJ, coluna D = notas no relatório Qive desde 07/08)
 * e grava uma planilha nova ao lado, com duas colunas a mais:
 *   "v2: notas desde 07/08" e "Situação na API v2".
 *
 * Uso: npx tsx --env-file=.env scripts\checar-cnpjs-qive-v2.ts caminho\cnpjs_para_qive.xlsx [AAAA-MM-DD]
 * (a data é o início da contagem; padrão 2026-08-07)
 */
import ExcelJS from "exceljs";

const QIVE_BASE = "https://api.arquivei.com.br";
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function total(cnpj: string, desde: string): Promise<{ http: number; total: number | null }> {
  const id = process.env.QIVE_API_ID ?? "";
  const key = process.env.QIVE_API_KEY ?? "";
  if (!id || !key) throw new Error("Credenciais da Qive não encontradas no .env.");
  const corpo = {
    Fields: ["AccessKey"],
    Filters: {
      Owners: [cnpj],
      OwnerRoles: ["received"],
      EmissionDate: { From: `${desde}T00:00:00Z`, To: `${new Date().toISOString().slice(0, 10)}T23:59:59Z` },
    },
    Limit: 1,
  };
  for (let t = 1; t <= 4; t++) {
    try {
      const res = await fetch(`${QIVE_BASE}/v2/dfe/nfe`, {
        method: "POST",
        headers: { "X-API-ID": id, "X-API-KEY": key, "X-Use-ApiGateway": "always", "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await dormir(2000 * t);
        continue;
      }
      const txt = await res.text();
      let j: any = null;
      try { j = JSON.parse(txt); } catch { /* ignora */ }
      return { http: res.status, total: res.ok && typeof j?.Total === "number" ? j.Total : null };
    } catch {
      await dormir(2000 * t);
    }
  }
  return { http: 0, total: null };
}

async function main() {
  const [arquivo, desdeArg] = process.argv.slice(2);
  if (!arquivo) throw new Error("Informe o caminho da planilha.");
  const desde = desdeArg ?? "2026-08-07";
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(arquivo);
  const ws = wb.worksheets[0];
  const colV2 = ws.columnCount + 1;
  ws.getRow(1).getCell(colV2).value = `v2: notas desde ${desde.split("-").reverse().slice(0, 2).join("/")}`;
  ws.getRow(1).getCell(colV2 + 1).value = "Situação na API v2";
  ws.getRow(1).font = { bold: true };

  let ok = 0, falta = 0, sem = 0, erro = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cnpj = String(row.getCell(1).value ?? "").replace(/\D/g, "");
    if (cnpj.length !== 14) continue;
    const esperado = Number(row.getCell(4).value ?? 0);
    const { http, total: n } = await total(cnpj, desde);
    let sit: string;
    if (n == null) { sit = `Erro (HTTP ${http})`; erro++; }
    else if (n === 0 && esperado > 0) { sit = "Sem acesso (0 notas)"; sem++; }
    else if (n >= esperado) { sit = "Completo"; ok++; }
    else { sit = `Faltam ${esperado - n} nota(s)`; falta++; }
    row.getCell(colV2).value = n;
    row.getCell(colV2 + 1).value = sit;
    console.log(`${cnpj} | v2: ${n ?? "?"} | relatório: ${esperado} | ${sit}`);
    await dormir(300);
  }
  const saida = arquivo.replace(/\.xlsx$/i, "") + "_v2.xlsx";
  await wb.xlsx.writeFile(saida);
  console.log(`\nCompletos: ${ok} | com falta: ${falta} | sem acesso: ${sem} | erro: ${erro}\nArquivo gravado: ${saida}`);
}
main().catch((e) => console.error(e.message));
