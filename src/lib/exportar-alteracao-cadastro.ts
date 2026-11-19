import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COLUNAS_ALTERACAO, REDE_MULTI, formulasDaLinha } from "@/lib/alteracao-formulas";
import { canonicalizarTamanho } from "@/lib/identificar-tamanho";
import { compararTamanhos, parseChaves, tamanhoEDescricaoDoItem } from "@/lib/exportar-cadastro-produtos";
import { idApiDoProduto } from "@/lib/produto-id";

/**
 * Planilha de ALTERAÇÃO DE CADASTRO (padrão novo): a coluna A (Referencia = código do produto no PDV,
 * rede MULTI — NÃO a referência do fornecedor da nota) é preenchida pelo app. O resto são as fórmulas
 * dbsleek do modelo, que buscam tudo no PDV ao abrir no Excel.
 *
 * Duas coisas que a planilha faz pelo app (cor, grupo, preço etc. vêm do dbsleek):
 *  1) tamanho que o produto já tem no PDV, mas sem EAN: o EAN da nota entra na posição desse tamanho;
 *  2) tamanho que o produto ainda NÃO tem no PDV: o tamanho entra no fim da coluna Tamanhos e o EAN dele
 *     no fim da coluna EANs (mesma posição).
 * Nunca duplica nem desloca: o EAN fica sempre na mesma posição do tamanho. A ligação nota -> produto do PDV
 * (para pôr o EAN na linha certa quando há várias cores) é feita internamente, a tela não mostra nada disso.
 */

export interface ResumoAlteracaoCadastro {
  linhas: number;
  semProdutoPdv: string[]; // "MODELO REFERENCIA" sem produto na rede MULTI
  eansPreenchidos: number; // EANs da nota encaixados em tamanhos que já existem no PDV
  tamanhosNovos: number; // tamanhos novos (com EAN) acrescentados ao fim das colunas Tamanhos/EANs
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
/** Tamanho "solto": o PDV infantil usa "2A", "10A"; a nota traz "2", "10". Compara pelos dígitos. */
const solto = (t: string | null | undefined): string => {
  const c = canonicalizarTamanho(t);
  const m = /^(\d{1,2})A$/.exec(c);
  return m ? m[1] : c;
};
const lit = (s: string) => `"${s.replace(/"/g, '""')}"`;

const parteL = (n: number) => Array.from({ length: 15 }, (_, k) => `IFERROR(${tamF(n, k + 1)},"")`);

/** Tamanhos: os do PDV (fórmula do modelo) + os novos no fim. */
function formulaTamanhos(n: number, novos: string[]): string {
  return `SUBSTITUTE(TRIM(${[...parteL(n), lit(novos.join(" "))].join('&" "&')})," ",";")`;
}

/**
 * EANs: o do PDV vale; onde está "[VAZIO]" entra o EAN da nota do tamanho daquela posição; os EANs dos
 * tamanhos novos vão no fim, na mesma ordem dos tamanhos novos. Null se passar do limite do Excel.
 */
function formulaEansPosicional(n: number, slots: number, existentes: Map<string, { ean: string; pdv: string }>, novosEans: string[]): string | null {
  const chaves: string[] = [];
  const eans: string[] = [];
  for (const [canon, { ean, pdv }] of existentes) {
    for (const k of new Set([pdv.trim().toUpperCase(), ...chavesDeTamanho(canon)])) { chaves.push(k); eans.push(ean); }
  }
  const arrC = `{${chaves.map(lit).join(",")}}`;
  const arrE = `{${eans.map(lit).join(",")}}`;
  const partes: string[] = [];
  for (let i = 1; i <= slots; i++) {
    partes.push(
      existentes.size
        ? `SUBSTITUTE(${eanF(n, i)},"[VAZIO]",IFERROR(INDEX(${arrE},MATCH(${tamDeL(n, i)},${arrC},0)),"[VAZIO]"))`
        : eanF(n, i)
    );
  }
  if (novosEans.length) partes.push(lit(novosEans.join(" ")));
  const f = `SUBSTITUTE(SUBSTITUTE(TRIM(${partes.join('&" "&')})," ",";"),"[VAZIO]","")`;
  return f.length <= MAX_FORMULA ? f : null;
}

interface VarLocal { ean: string | null; tamanho: string | null }
interface ProdLocal { codigo: string; chave: string; vars: VarLocal[] }

export async function gerarAlteracaoCadastroXlsx(
  chaves: unknown
): Promise<{ buffer: Buffer; resumo: ResumoAlteracaoCadastro }> {
  const pares = parseChaves(chaves).filter((p) => p.modelo && p.referencia);
  const resumo: ResumoAlteracaoCadastro = { linhas: 0, semProdutoPdv: [], eansPreenchidos: 0, tamanhosNovos: 0, eansSemPosicao: [] };

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

  // produto -> EANs da nota a encaixar (tamanhos que já existem) e tamanhos novos (a cadastrar)
  interface Plano { existentes: Map<string, { ean: string; pdv: string }>; novos: Map<string, string> }
  const colocar = new Map<string, Plano>();
  const sobras = new Map<string, string[]>(); // por par: "EAN — motivo"
  for (const g of grupos.values()) {
    if (!g.faltando.length) continue;
    const prods = produtosPorPar.get(g.par) ?? [];
    let alvo: ProdLocal | null = null;
    let melhor = 0;
    for (const p of prods) {
      const n = p.vars.filter((v) => v.ean && g.eans.has(v.ean)).length;
      if (n > melhor) { melhor = n; alvo = p; }
    }
    if (!alvo && prods.length === 1) alvo = prods[0];
    const semTam = g.faltando.filter((x) => !x.tam).length;
    const tamanhosDe = (p: ProdLocal) => new Map(p.vars.filter((v) => v.tamanho).map((v) => [solto(v.tamanho), v.tamanho!.trim()]));
    for (const f of g.faltando) {
      const motivo = (m: string) => sobras.set(g.par, [...(sobras.get(g.par) ?? []), `${f.ean} — ${m}`]);
      let a: ProdLocal | null = alvo;
      // Vários produtos com a mesma referência (ex.: adulto e infantil) e sem EAN para ligar: o tamanho decide,
      // se existir em um único deles.
      if (!a && prods.length > 1 && f.tam) {
        const cands = prods.filter((p) => tamanhosDe(p).has(solto(f.tam)));
        if (cands.length === 1) a = cands[0];
      }
      if (!a) { motivo(prods.length ? "não deu para saber de qual produto (cor) do PDV é" : "sem produto na MULTI"); continue; }
      const tams = tamanhosDe(a);
      let tam = f.tam ? solto(f.tam) : null;
      if (!tam) {
        // sem tamanho na nota: só dá para colocar se o produto tem um único tamanho e esta é a única pendência
        if (tams.size === 1 && semTam === 1) tam = [...tams.keys()][0];
        else { motivo("tamanho não identificado na nota"); continue; }
      }
      // Produto de tamanho ÚNICO (UN) no PDV: nunca cria tamanho novo. O "tamanho" achado na nota costuma ser
      // lixo da descrição (ex.: "LUVA COM 1" -> "1"); o EAN vai para o tamanho UN se for o único da nota.
      if (!tams.has(tam) && tams.size === 1 && [...tams.keys()][0] === "UN") {
        if (g.faltando.length === 1) tam = "UN";
        else { motivo("produto de tamanho único (UN) com mais de um EAN na nota"); continue; }
      }
      const plano = colocar.get(a.chave) ?? { existentes: new Map<string, { ean: string; pdv: string }>(), novos: new Map<string, string>() };
      if (tams.has(tam)) {
        const jaTemEan = a.vars.some((v) => v.tamanho && solto(v.tamanho) === tam && v.ean);
        if (jaTemEan) { motivo(`o PDV já tem outro EAN no tamanho ${tam}`); continue; }
        if (plano.existentes.has(tam)) { motivo(`dois EANs da nota para o tamanho ${tam}`); continue; }
        plano.existentes.set(tam, { ean: f.ean, pdv: tams.get(tam)! });
      } else {
        // tamanho novo: se o produto usa a grafia "10A", escreve "10A"
        const usaA = [...tams.values()].some((v) => /^\d{1,2}A$/i.test(v.trim()));
        const grafia = usaA && /^\d{1,2}$/.test(tam) ? `${tam}A` : tam;
        if (plano.novos.has(grafia)) { motivo(`dois EANs da nota para o tamanho novo ${grafia}`); continue; }
        plano.novos.set(grafia, f.ean);
      }
      colocar.set(a.chave, plano);
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

      // Tamanhos novos e EANs da nota, quando houver para este produto
      const plano = colocar.get(prod.chave);
      let amarelar = (sobras.get(k)?.length ?? 0) > 0;
      if (plano && (plano.existentes.size || plano.novos.size)) {
        const nTam = new Set(prod.vars.map((v) => (v.tamanho ?? "").trim()).filter(Boolean)).size;
        const novosOrdenados = [...plano.novos.entries()].sort((a, b) => compararTamanhos(a[0], b[0]));
        // com tamanho novo no fim, as posições têm de ser exatas (sem folga); sem ele, 1 posição de folga
        const slots = Math.min(15, novosOrdenados.length ? nTam : nTam + 1);
        const f = formulaEansPosicional(n, slots, plano.existentes, novosOrdenados.map(([, e]) => e));
        if (f && nTam + novosOrdenados.length <= 15) {
          fx[25] = { f, array: false };
          if (novosOrdenados.length) fx[12] = { f: formulaTamanhos(n, novosOrdenados.map(([t]) => t)), array: false };
          resumo.eansPreenchidos += plano.existentes.size;
          resumo.tamanhosNovos += novosOrdenados.length;
        } else {
          amarelar = true;
          for (const e of [...[...plano.existentes.values()].map((x) => x.ean), ...plano.novos.values()])
            resumo.eansSemPosicao.push(`${p.modelo} ${p.referencia}: ${e} — fórmula longa demais (muitos tamanhos/EANs); preencher à mão`);
        }
      }
      // O dbsleek devolve "[VAZIO]" quando o campo está vazio no PDV: na planilha tem que sair em branco.
      for (const col of [2, 3, 4, 5, 6, 7, 8, 10, 11, 14, 16, 18, 20, 23, 27]) {
        const x = fx[col];
        x.f = `IF(${x.f}="[VAZIO]","",${x.f})`;
      }
      fx[12].f = `SUBSTITUTE(${fx[12].f},"[VAZIO]","")`;
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
