/**
 * SIMULAÇÃO (somente leitura) da importação pela API v2 da Qive.
 * Para cada CNPJ, lista as notas recebidas dos últimos 90 dias (POST /v2/dfe/nfe, só a chave de acesso)
 * e compara com o que já existe no banco (Note.chaveAcesso). Não grava nada.
 * Também testa quais campos de XML a v2 aceita (para a importação real).
 *
 * Uso:
 *   npx tsx --env-file=.env scripts\simular-qive-v2.ts                       (CNPJs: lojas ativas + notas + certificados do banco)
 *   npx tsx --env-file=.env scripts\simular-qive-v2.ts --planilha=C:\caminho\cnpjs_para_qive.xlsx   (CNPJs da coluna A)
 * Opções: --dias=90  --csv  (grava simulacao_qive_v2_faltantes.csv na pasta atual)
 */
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import fs from "fs";

const prisma = new PrismaClient();
const QIVE_BASE = "https://api.arquivei.com.br";
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const flag = (n: string) => process.argv.includes(`--${n}`);

async function chamar(corpo: unknown): Promise<{ http: number; json: any; txt: string }> {
  const id = process.env.QIVE_API_ID ?? "";
  const key = process.env.QIVE_API_KEY ?? "";
  if (!id || !key) throw new Error("Credenciais da Qive não encontradas no .env.");
  for (let t = 1; t <= 4; t++) {
    try {
      const res = await fetch(`${QIVE_BASE}/v2/dfe/nfe`, {
        method: "POST",
        headers: { "X-API-ID": id, "X-API-KEY": key, "X-Use-ApiGateway": "always", "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status === 429 || res.status >= 500) { await dormir(2000 * t); continue; }
      const txt = await res.text();
      let json: any = null;
      try { json = JSON.parse(txt); } catch { /* ignora */ }
      return { http: res.status, json, txt };
    } catch {
      await dormir(2000 * t);
    }
  }
  return { http: 0, json: null, txt: "" };
}

interface NotaV2 { AccessKey: string; EmissionDate?: string; Number?: string; Status?: string }

async function listarNotas(cnpj: string, de: string, ate: string): Promise<{ notas: NotaV2[]; total: number | null; aviso?: string }> {
  const notas: NotaV2[] = [];
  let paginator = "";
  let total: number | null = null;
  for (let pag = 0; pag < 200; pag++) {
    const corpo: any = {
      Fields: ["AccessKey", "EmissionDate", "Number", "Status"],
      Filters: { Owners: [cnpj], OwnerRoles: ["received"], EmissionDate: { From: `${de}T00:00:00Z`, To: `${ate}T23:59:59Z` } },
      Limit: 500,
    };
    if (paginator) corpo.Paginator = paginator;
    const r = await chamar(corpo);
    if (r.http !== 200 || !r.json) return { notas, total, aviso: `HTTP ${r.http}: ${r.txt.slice(0, 120)}` };
    total = typeof r.json.Total === "number" ? r.json.Total : total;
    const lista: NotaV2[] = Array.isArray(r.json.Nfes) ? r.json.Nfes : [];
    notas.push(...lista);
    const prox = String(r.json.Paginator ?? "");
    if (!lista.length || !prox || prox === paginator || lista.length < 500) break;
    paginator = prox;
    await dormir(200);
  }
  return { notas, total };
}

async function cnpjsDaPlanilha(caminho: string): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  const ws = wb.worksheets[0];
  const out: string[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const c = String(ws.getRow(r).getCell(1).value ?? "").replace(/\D/g, "");
    if (c.length === 14) out.push(c);
  }
  return [...new Set(out)];
}

async function cnpjsDoBanco(): Promise<string[]> {
  const lojas = await prisma.lojaCadastro.findMany({ where: { ativa: true }, select: { cnpj: true } });
  const certs = await prisma.certificate.findMany({ select: { cnpj: true } });
  const notas = await prisma.$queryRaw<{ c: string }[]>`SELECT DISTINCT "cnpjDestino" AS c FROM "Note" WHERE "cnpjDestino" IS NOT NULL`;
  const set = new Set<string>();
  for (const x of [...lojas.map((l) => l.cnpj), ...certs.map((c) => c.cnpj), ...notas.map((n) => n.c)]) {
    const d = String(x ?? "").replace(/\D/g, "");
    if (d.length === 14) set.add(d);
  }
  return [...set];
}

/** Descobre se a v2 entrega o XML e com qual nome de campo (não imprime o conteúdo). */
async function sondarXml(cnpj: string, de: string, ate: string) {
  console.log("\nSonda: a v2 devolve o XML da nota? (testando nomes de campo)");
  for (const campo of ["Xml", "XML", "XmlBase64", "Content", "Base64"]) {
    const r = await chamar({
      Fields: ["AccessKey", campo],
      Filters: { Owners: [cnpj], OwnerRoles: ["received"], EmissionDate: { From: `${de}T00:00:00Z`, To: `${ate}T23:59:59Z` } },
      Limit: 1,
    });
    const item = r.json?.Nfes?.[0];
    if (r.http === 200 && item) {
      const info = Object.entries(item).map(([k, v]) => `${k}${typeof v === "string" && v.length > 80 ? ` (texto de ${v.length} caracteres)` : ""}`);
      console.log(`  campo "${campo}": HTTP 200 | campos no item: ${info.join(", ")}`);
    } else {
      console.log(`  campo "${campo}": HTTP ${r.http} ${r.json?.error?.message ?? r.txt.slice(0, 80)}`);
    }
    await dormir(300);
  }
}

async function main() {
  const dias = Number(arg("dias") ?? 90);
  const ate = new Date().toISOString().slice(0, 10);
  const de = new Date(Date.now() - (dias - 1) * 86_400_000).toISOString().slice(0, 10);
  const planilha = arg("planilha");
  const cnpjs = planilha ? await cnpjsDaPlanilha(planilha) : await cnpjsDoBanco();
  console.log(`Simulação (não grava nada): ${cnpjs.length} CNPJs | emissão de ${de} a ${ate}\n`);

  const porCnpj: { cnpj: string; notas: NotaV2[]; aviso?: string }[] = [];
  for (const cnpj of cnpjs) {
    const r = await listarNotas(cnpj, de, ate);
    porCnpj.push({ cnpj, notas: r.notas, aviso: r.aviso });
    await dormir(200);
  }

  const todas = [...new Set(porCnpj.flatMap((p) => p.notas.map((n) => n.AccessKey)))];
  const existentes = new Set<string>();
  for (let i = 0; i < todas.length; i += 5000) {
    const rows = await prisma.note.findMany({ where: { chaveAcesso: { in: todas.slice(i, i + 5000) } }, select: { chaveAcesso: true } });
    for (const x of rows) existentes.add(x.chaveAcesso);
  }

  let totV2 = 0, totFalta = 0, semAcesso = 0, comAviso = 0;
  const linhasCsv = ["cnpj;chave;numero;emissao;status"];
  let primeiroComFalta: string | null = null;
  for (const p of porCnpj) {
    const faltam = p.notas.filter((n) => !existentes.has(n.AccessKey));
    totV2 += p.notas.length;
    totFalta += faltam.length;
    if (p.aviso) { comAviso++; console.log(`${p.cnpj} | ERRO: ${p.aviso}`); continue; }
    if (p.notas.length === 0) { semAcesso++; console.log(`${p.cnpj} | v2: 0 notas`); continue; }
    if (faltam.length && !primeiroComFalta) primeiroComFalta = p.cnpj;
    console.log(`${p.cnpj} | v2: ${p.notas.length} | já no banco: ${p.notas.length - faltam.length} | FALTAM: ${faltam.length}`);
    for (const n of faltam) linhasCsv.push(`${p.cnpj};${n.AccessKey};${n.Number ?? ""};${n.EmissionDate ?? ""};${n.Status ?? ""}`);
  }
  console.log(`\nResumo: ${cnpjs.length} CNPJs | notas na v2: ${totV2} | já no banco: ${totV2 - totFalta} | FALTAM no banco: ${totFalta} | CNPJs sem nota na v2: ${semAcesso} | com erro: ${comAviso}`);
  if (flag("csv")) {
    fs.writeFileSync("simulacao_qive_v2_faltantes.csv", linhasCsv.join("\n"), "utf8");
    console.log("Arquivo gravado: simulacao_qive_v2_faltantes.csv");
  }
  await sondarXml(primeiroComFalta ?? porCnpj.find((p) => p.notas.length)?.cnpj ?? cnpjs[0], de, ate);
}

main()
  .catch((e) => console.error(e.message))
  .finally(() => prisma.$disconnect());
