import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COLUNAS_ALTERACAO, REDE_MULTI, formulaY, formulasDaLinha } from "@/lib/alteracao-formulas";
import { canonicalizarTamanho } from "@/lib/identificar-tamanho";
import { parseChaves, tamanhoEDescricaoDoItem } from "@/lib/exportar-cadastro-produtos";
import { idApiDoProduto } from "@/lib/produto-id";

/**
 * Planilha de ALTERAÇÃO DE CADASTRO (padrão novo): a coluna A (Referencia = código do produto no PDV,
 * rede MULTI — NÃO a referência do fornecedor da nota) é preenchida pelo app. O resto são as fórmulas
 * dbsleek do modelo, que buscam tudo no PDV ao abrir no Excel.
 *
 * Coluna EANs: mantém a fórmula do modelo (um EAN por tamanho, na ordem dos tamanhos, "[VAZIO]" onde o PDV
 * não tem) e, só nas posições em que o PDV está vazio, entra o EAN da nota DAQUELE tamanho e DAQUELA cor.
 * Nunca duplica nem desloca: o EAN fica na mesma posição do tamanho da coluna Tamanhos.
 */

export interface ResumoAlteracaoCadastro {
  linhas: number;
  semProdutoPdv: string[]; // "MODELO REFERENCIA" sem produto na rede MULTI
  eansPreenchidos: number; // EANs da nota encaixados na posição do tamanho
  eansSemPosicao: string[]; // EANs da nota que não deu para encaixar (EAN — motivo)
}

const MAX_FORMULA = 8000; // limite do Excel: 8192 caracteres

// ---- peças das fórmulas (iguais às do modelo) --------------------------------
const tamF = (n: number, i: number) =>
  `_xll.dbsleek("lista","dbase.bin","produtos","tamanho","referencia","=",$A${n},"rede","=","multi",${i})`;
const eanF = (n: number, i: number) =>
  `IFERROR(_xll.dbsleek("mostra","dbase.bin","produtos","ean","referencia","=",$A${n},"rede","=","multi","tamanho","=",${tamF(n, i)}),"")`;
// i-ésimo tamanho da coluna L (Tamanhos, separados por ";")
const tamDeL = (n: number, i: number) => `TRIM(MID(SUBSTITUTE($L${n},";",REPT(" ",60)),${(i - 1) * 60 + 1},60))`;

// Grafias que o PDV usa para o mesmo tamanho (inverso de canonicalizarTamanho).
const ALIAS: Record<string, string[]> = {
  P: ["S", "PQ", "MD"], G: ["L", "GR", "1G"], GG: ["XL"], "2G": ["XXL", "2XL"], "3G": ["XXXL", "3XL"], "4G": ["4XL"],
  PP: ["XS"], "2PP": ["XXS", "2XS"], "3PP": ["3XS"], "4PP": ["4XS"],
  UN: ["U", "TU", "UNICO", "ÚNICO", "UNICA", "ÚNICA", "ONE", "ONESIZE"],
};
function chavesDeTamanho(canon: string): string[] {
  const out = new Set<string>([canon, ...(ALIAS[canon] ?? [])]);
  if (canon.includes(".")) out.add(canon.replace(".", ","));
  if (canon.includes(",")) out.add(canon.replace(",", "."));
  return [...out];
}
const lit = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Fórmula posicional: o EAN do PDV vale; onde está "[VAZIO]" entra o EAN da nota do tamanho da posição. Null se passar do limite. */
export function formulaEansPosicional(n: number, slots: number, porTamanho: Map<string, string>): string | null {
  const chaves: string[] = [];
  const eans: string[] = [];
  for (const [canon, ean] of porTamanho) for (const k of chavesDeTamanho(canon)) { chaves.push(k); eans.push(ean); }
  const arrC = `{${chaves.map(lit).join(",")}}`;
  const arrE = `{${eans.map(lit).join(",")}}`;
  const partes: string[] = [];
  for (let i = 1; i <= slots; i++) {
    partes.push(`SUBSTITUTE(${eanF(n, i)},"[VAZIO]",IFERROR(INDEX(${arrE},MATCH(${tamDeL(n, i)},${arrC},0)),"[VAZIO]"))`);
  }
  const f = `SUBSTITUTE(SUBSTITUTE(TRIM(${partes.join('&" "&')})," ",";"),"[VAZIO]","")`;
  return f.length <= MAX_FORMULA ? f : null;
}

interface VarLocal { ean: string | null; tamanho: string | null }
interface ProdLocal { codigo: string; chave: string; vars: VarLocal[] }

export async function gerarAlteracaoCadastroXlsx(
  chaves: unknown
): Promise<{ buffer: Buffer; resumo: ResumoAlteracaoCadastro }> {
  const pares = parseChaves(chaves).filter((p) => p.modelo && p.referencia);
  const resumo: ResumoAlteracaoCadastro = { linhas: 0, semProdutoPdv: [], eansPreenchidos: 0, eansSemPosicao: [] };

  const mods = pares.map((p) => p.modelo!.trim().toUpperCase());
  const refs = pares.map((p) => p.referencia!.trim().toUpperCase());

  // ---- produtos do PDV (rede MULTI) + variações locais ---------------------------
  const produtosPorPar = new Map<string, ProdLocal[]>();
  const produtoPorId = new Map<string, ProdLocal>();
  if (pares.length) {
    const prods = await prisma.$queryRaw<{ id: string; mod_u: string; ref_u: string }[]>(Prisma.sql`
      SELECT p.id, upper(trim(p."modeloNome")) AS mod_u, upper(trim(p."referenciaFornecedor")) AS ref_u
        FROM "Produto" p
        JOIN unnest(${mods}::text[], ${refs}::text[]) AS c(m, r)
          ON upper(trim(p."modeloNome")) = c.m AND upper(trim(p."referenciaFornecedor")) = c.r
       WHERE p."redeId" = ${REDE_MULTI}`);
    const vars = prods.length
      ? await prisma.variacaoProduto.findMany({
          where: { produtoId: { in: prods.map((p) => p.id) } },
          select: { produtoId: true, ean: true, tamanho: true },
        })
      : [];
    for (const p of prods) {
      const pl: ProdLocal = { codigo: idApiDoProduto(p.id), chave: p.id, vars: [] };
      produtoPorId.set(p.id, pl);
      const k = `${p.mod_u}|${p.ref_u}`;
      produtosPorPar.set(k, [...(produtosPorPar.get(k) ?? []), pl]);
    }
    for (const v of vars) produtoPorId.get(v.produtoId)?.vars.push({ ean: v.ean, tamanho: v.tamanho });
  }

  // ---- itens de nota dos pares (todos com EAN válido) ------------------------------
  interface ItemNota {
    mod_u: string; ref_u: string; ean: string; codigo: string; descricao: string; inf: string | null;
    emitente: string | null; modelo: string; referencia: string; falta: boolean;
  }
  const itens = pares.length
    ? await prisma.$queryRaw<ItemNota[]>(Prisma.sql`
        SELECT upper(trim(i."modeloIdentificado")) AS mod_u, upper(trim(i."referenciaFornecedorIdentificada")) AS ref_u,
               i.ean AS ean, i."codigoProduto" AS codigo, i.descricao AS descricao, i."infAdProd" AS inf,
               n."emitenteNome" AS emitente, i."modeloIdentificado" AS modelo, i."referenciaFornecedorIdentificada" AS referencia,
               NOT EXISTS (SELECT 1 FROM "VariacaoProduto" v WHERE v.ean = i.ean) AS falta
          FROM "NotaItem" i
          JOIN "Note" n ON n.id = i."noteId"
          JOIN unnest(${mods}::text[], ${refs}::text[]) AS c(m, r)
            ON upper(trim(i."modeloIdentificado")) = c.m AND upper(trim(i."referenciaFornecedorIdentificada")) = c.r
         WHERE i.ean ~ '^[0-9]{8,14}$'
         ORDER BY n."dataEmissao" DESC NULLS LAST`)
    : [];

  // grupo (cor) = modelo + ref + descrição sem tamanho; acha o produto do PDV pelos EANs que já existem lá
  interface Grupo { par: string; eans: Set<string>; faltando: { ean: string; tam: string | null }[] }
  const grupos = new Map<string, Grupo>();
  for (const it of itens) {
    const { tam, descSemTam } = tamanhoEDescricaoDoItem({
      emitente: it.emitente, modelo: it.modelo, codigo: it.codigo, descricao: it.descricao,
      ean: it.ean, infAdProd: it.inf, referencia: it.referencia,
    });
    const par = `${it.mod_u}|${it.ref_u}`;
    const gk = `${par}|${descSemTam}`;
    const g = grupos.get(gk) ?? { par, eans: new Set<string>(), faltando: [] };
    g.eans.add(it.ean);
    if (it.falta && !g.faltando.some((f) => f.ean === it.ean)) g.faltando.push({ ean: it.ean, tam });
    grupos.set(gk, g);
  }

  // produto -> (tamanho canônico -> EAN da nota); e o que sobra sem posição
  const colocar = new Map<string, Map<string, string>>();
  const sobras = new Map<string, string[]>(); // por par: "EAN — motivo"
  const comNotaFaltando = new Set<string>();
  for (const g of grupos.values()) {
    if (!g.faltando.length) continue;
    comNotaFaltando.add(g.par);
    const prods = produtosPorPar.get(g.par) ?? [];
    let alvo: ProdLocal | null = null;
    let melhor = 0;
    for (const p of prods) {
      const n = p.vars.filter((v) => v.ean && g.eans.has(v.ean)).length;
      if (n > melhor) { melhor = n; alvo = p; }
    }
    if (!alvo && prods.length === 1) alvo = prods[0];
    for (const f of g.faltando) {
      const motivo = (m: string) => sobras.set(g.par, [...(sobras.get(g.par) ?? []), `${f.ean} — ${m}`]);
      if (!alvo) { motivo(prods.length ? "não deu para saber de qual cor/produto é" : "sem produto na MULTI"); continue; }
      const tams = new Set(alvo.vars.map((v) => (v.tamanho ? canonicalizarTamanho(v.tamanho) : "")));
      let tam = f.tam;
      // produto de tamanho único e uma só pendência: não precisa saber o tamanho da nota
      if (!tam || !tams.has(tam)) {
        const unicos = [...tams].filter(Boolean);
        const pend = g.faltando.filter((x) => !x.tam || !tams.has(x.tam)).length;
        if (unicos.length === 1 && pend === 1) tam = unicos[0];
        else { motivo(`tamanho "${f.tam ?? "?"}" não existe nas variações desse produto no PDV`); continue; }
      }
      const jaTemEan = alvo.vars.some((v) => v.tamanho && canonicalizarTamanho(v.tamanho) === tam && v.ean);
      if (jaTemEan) { motivo(`o PDV já tem outro EAN no tamanho ${tam}`); continue; }
      const m = colocar.get(alvo.chave) ?? new Map<string, string>();
      if (!m.has(tam)) { m.set(tam, f.ean); colocar.set(alvo.chave, m); }
      else motivo(`dois EANs da nota para o tamanho ${tam}`);
    }
  }

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet");
  ws.addRow(COLUNAS_ALTERACAO).font = { bold: true };
  const amarelo = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2A8" } } as const;

  const ordenados = [...pares].sort(
    (a, b) => a.modelo!.localeCompare(b.modelo!, "pt-BR") || a.referencia!.localeCompare(b.referencia!, "pt-BR")
  );
  const vistos = new Set<string>();
  for (const p of ordenados) {
    const k = `${p.modelo!.trim().toUpperCase()}|${p.referencia!.trim().toUpperCase()}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    const lista = produtosPorPar.get(k);
    if (!lista?.length) {
      resumo.semProdutoPdv.push(`${p.modelo} ${p.referencia}`);
      continue;
    }
    for (const sob of sobras.get(k) ?? []) resumo.eansSemPosicao.push(`${p.modelo} ${p.referencia}: ${sob}`);
    const unicos = [...new Map(lista.map((x) => [x.codigo, x])).values()].sort((a, b) =>
      a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true })
    );
    for (const prod of unicos) {
      const row = ws.addRow([]);
      const n = row.number;
      row.getCell(1).value = prod.codigo;
      const fx = formulasDaLinha(n);
      fx[14] = { f: `_xll.dbsleek("MOSTRA","DBASE.BIN","PRODUTOS","CUSTO_TOTAL","REFERENCIA","=",$A${n},"REDE","=","MULTI")`, array: true };
      fx[16] = { f: `_xll.dbsleek("MOSTRA","DBASE.BIN","PRODUTOS","CUSTO_BRUTO","REFERENCIA","=",$A${n},"REDE","=","MULTI")`, array: true };
      fx[18] = { f: `_xll.dbsleek("MOSTRA","DBASE.BIN","PRODUTOS","PRECO_VAREJO","REFERENCIA","=",$A${n},"REDE","=","MULTI")`, array: true };
      fx[20] = { f: `_xll.dbsleek("MOSTRA","DBASE.BIN","PRODUTOS","PRECO_VAREJO_OFFRIO","REFERENCIA","=",$A${n},"REDE","=","MULTI")`, array: true };
      fx[23] = { f: `TRIM(_xll.dbsleek("MOSTRA","DBASE.BIN","PRODUTOS",W$1,"REFERENCIA","=",$A${n},"REDE","=","MULTI"))`, array: true };

      // EANs: posicional quando há EAN da nota a encaixar neste produto
      const plano = colocar.get(prod.chave);
      let amarelar = (sobras.get(k)?.length ?? 0) > 0;
      if (plano?.size) {
        const nTam = new Set(prod.vars.map((v) => (v.tamanho ?? "").trim()).filter(Boolean)).size;
        const f = formulaEansPosicional(n, Math.min(15, nTam + 1), plano);
        if (f) {
          fx[25] = { f, array: false };
          resumo.eansPreenchidos += plano.size;
        } else {
          amarelar = true;
          for (const e of plano.values()) resumo.eansSemPosicao.push(`${p.modelo} ${p.referencia}: ${e} — fórmula longa demais (muitos tamanhos/EANs); preencher à mão`);
        }
      }
      for (const [col, x] of Object.entries(fx)) {
        const c = row.getCell(Number(col));
        c.numFmt = "General";
        c.value = x.array ? ({ formula: x.f, shareType: "array", ref: `${c.address}` } as any) : ({ formula: x.f } as any);
      }
      if (amarelar) row.getCell(25).fill = amarelo as any;
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
