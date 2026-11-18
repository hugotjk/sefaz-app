import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COLUNAS_ALTERACAO, REDE_MULTI, formulaY, formulasDaLinha } from "@/lib/alteracao-formulas";
import { canonicalizarTamanho, identificarTamanho, tamanhoGenerico } from "@/lib/identificar-tamanho";
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

const ORDEM_LETRAS = ["PP", "P", "M", "G", "GG", "XG", "XGG", "EG", "EGG", "2G", "3G", "4G"];
/** Posição do tamanho para ordenar: números (calçado/idade) crescentes, depois letras PP..GG, UN, sem tamanho por último. */
function postoTamanho(t: string | null): [number, number, string] {
  if (!t) return [3, 0, ""];
  const c = canonicalizarTamanho(t);
  const num = parseFloat(c.replace(",", "."));
  if (Number.isFinite(num) && /^\d/.test(c)) return [0, num, c];
  const i = ORDEM_LETRAS.indexOf(c);
  if (i >= 0) return [1, i, c];
  return [2, 0, c];
}
const cmpPosto = (a: [number, number, string], b: [number, number, string]) =>
  a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2], "pt-BR");

/** Fórmula da coluna EANs: EANs do PDV (como no modelo) + os da nota que o PDV ainda não tem, ao final. */
function formulaEans(n: number, extras: string[]): string {
  if (!extras.length) return formulaY(n);
  // Uma única vez a fórmula do modelo (limite de 8192 caracteres do Excel): "a;b" + " e1 e2" -> "a;b;e1;e2"; vazio -> "e1;e2".
  return `SUBSTITUTE(TRIM(${formulaY(n)}&" ${extras.join(" ")}")," ",";")`;
}

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

  // EANs das notas que NENHUMA variação do PDV tem, por (modelo, referência), na ordem do tamanho.
  const eansNota = new Map<string, string[]>();
  if (pares.length) {
    const mods = pares.map((p) => p.modelo!.trim().toUpperCase());
    const refs = pares.map((p) => p.referencia!.trim().toUpperCase());
    const itens = await prisma.$queryRaw<
      { mod_u: string; ref_u: string; ean: string; codigo: string; descricao: string; inf: string | null; emitente: string | null; modelo: string; referencia: string }[]
    >(Prisma.sql`
      SELECT upper(trim(i."modeloIdentificado")) AS mod_u, upper(trim(i."referenciaFornecedorIdentificada")) AS ref_u,
             i.ean AS ean, i."codigoProduto" AS codigo, i.descricao AS descricao, i."infAdProd" AS inf,
             n."emitenteNome" AS emitente, i."modeloIdentificado" AS modelo, i."referenciaFornecedorIdentificada" AS referencia
        FROM "NotaItem" i
        JOIN "Note" n ON n.id = i."noteId"
        JOIN unnest(${mods}::text[], ${refs}::text[]) AS c(m, r)
          ON upper(trim(i."modeloIdentificado")) = c.m AND upper(trim(i."referenciaFornecedorIdentificada")) = c.r
       WHERE i.ean ~ '^[0-9]{8,14}$'
         AND NOT EXISTS (SELECT 1 FROM "VariacaoProduto" v WHERE v.ean = i.ean)`);
    const porChave = new Map<string, Map<string, [number, number, string]>>();
    for (const it of itens) {
      const tam =
        identificarTamanho({
          emitente: it.emitente ?? "", modelo: it.modelo, codigo: it.codigo, descricao: it.descricao,
          ean: it.ean, infAdProd: it.inf ?? undefined, referencia: it.referencia,
        } as any) ?? tamanhoGenerico({ codigo: it.codigo, descricao: it.descricao, infAdProd: it.inf ?? undefined } as any);
      const k = `${it.mod_u}|${it.ref_u}`;
      const m = porChave.get(k) ?? new Map();
      if (!m.has(it.ean)) m.set(it.ean, postoTamanho(tam));
      porChave.set(k, m);
    }
    for (const [k, m] of porChave) {
      eansNota.set(k, [...m.entries()].sort((a, b) => cmpPosto(a[1], b[1]) || a[0].localeCompare(b[0])).map(([e]) => e));
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
      fx[25] = { f: formulaEans(n, eansNota.get(k) ?? []), array: false };
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
