import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { parseNFeXml } from "@/lib/parse-nfe-xml";
import {
  canonicalizarTamanho,
  identificarTamanho,
  tamanhoGenerico,
  tamanhoPlausivel,
} from "@/lib/identificar-tamanho";
import { tipoEGrupoLacoste } from "@/lib/lacoste-grupos";

/**
 * Exporta, no padrão do "Guia do Usuário — Importação de Produtos WQS", os
 * produtos SEM CADASTRO que foram marcados na Conferência de Produtos.
 *
 * Uma linha = uma referência (modelo + referência do fornecedor + descrição
 * sem o tamanho). Tamanhos e EANs vão na mesma ordem, separados por ";".
 * O que o app ainda não sabe fica EM BRANCO (Grupo, Linha, Coleção, Cor,
 * Comprador, Preco3...) para ser ensinado depois.
 */

export const COLUNAS_CADASTRO = [
  "Referencia",
  "Grupo",
  "Modelo",
  "Linha",
  "Colecao",
  "Fornecedor",
  "Grade",
  "Descricao",
  "Unidade",
  "ReferenciaFornecedor",
  "Cor",
  "Tamanhos",
  "TabelaPreco1",
  "Preco1",
  "TabelaPreco2",
  "Preco2",
  "TabelaPreco3",
  "Preco3",
  "TabelaPreco4",
  "Preco4",
  "TabelaPreco5",
  "Preco5",
  "NCM",
  "CEST",
  "EANs",
  "TipoProduto",
  "Comprador (SubGrupo)",
] as const;

// Códigos das tabelas de preço do PDV, nas 5 posições (1 custo bruto, 2 custo
// total, 3 varejo, 7 e 9 conforme combinado).
const TABELAS = [1, 2, 3, 7, 9];

export interface ParProduto {
  modelo: string | null;
  referencia: string | null;
}

export interface ResumoExportacao {
  produtosSelecionados: number;
  linhas: number;
  semTamanho: number; // linhas com algum tamanho não identificado (Tamanhos/EANs ficam em branco)
  semEan: number; // linhas com EAN faltando em algum tamanho
  eanRepetido: number;
  fornecedorDoPdv: number;
  fornecedorDaNota: number;
}

export function parseChaves(chaves: unknown): ParProduto[] {
  if (!Array.isArray(chaves)) return [];
  const out: ParProduto[] = [];
  for (const c of chaves) {
    if (typeof c !== "string") continue;
    try {
      const [m, r] = JSON.parse(c);
      out.push({ modelo: m ?? null, referencia: r ?? null });
    } catch {
      /* chave inválida: ignora */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (s: string | null | undefined) => semAcento(s ?? "").toUpperCase();

function temPalavra(texto: string, palavras: string[]): boolean {
  const t = ` ${norm(texto).replace(/[^A-Z0-9]+/g, " ")} `;
  return palavras.some((p) => t.includes(` ${p} `));
}

const ORDEM_LETRAS = ["4PP", "3PP", "2PP", "PP", "P", "M", "G", "GG", "XG", "XGG", "EG", "EGG", "2G", "3G", "4G", "5G"];
function chaveOrdem(t: string): [number, number, string] {
  const num = /^(\d+(?:[.,]\d+)?)/.exec(t);
  if (num && !ORDEM_LETRAS.includes(t)) return [1, parseFloat(num[1].replace(",", ".")), t];
  const i = ORDEM_LETRAS.indexOf(t);
  if (i >= 0) return [0, i, t];
  return [2, 0, t];
}
function compararTamanhos(a: string, b: string) {
  const x = chaveOrdem(a);
  const y = chaveOrdem(b);
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
}

function descricaoSemTamanho(desc: string, tam: string | null): string {
  let d = desc.replace(/\s+/g, " ").trim();
  d = d.replace(/\s*[-–/]?\s*\bTAM(?:ANHO)?\.?\s*:?\s*[A-Z0-9/.,]+\s*$/i, "");
  if (tam) {
    const esc = tam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    d = d.replace(new RegExp(`(?:\\s*[-–/]\\s*|\\s+)${esc}\\s*$`, "i"), "");
  }
  return d.trim().toUpperCase();
}

function soDigitos(s: string | null | undefined) {
  return (s ?? "").replace(/\D/g, "");
}

const ROUPAS = ["CAMISA", "CAMISETA", "BERMUDA", "SHORT", "SHORTS", "JAQUETA", "MOLETOM", "CALCA", "BLUSA", "REGATA", "VESTIDO", "BODY", "MACACAO", "SAIA", "COLETE", "CORTA", "VENTO", "POLO", "CONJUNTO", "BIQUINI", "MAIO", "SUNGA", "CUECA", "LEGGING", "TOP", "T", "SHIRT", "TSHIRT", "CASACO", "AGASALHO", "JERSEY"];

interface ItemBase {
  id: string;
  noteId: string;
  codigo: string;
  descricao: string;
  ean: string | null;
  ncm: string | null;
  infAdProd: string | null;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  modelo: string | null;
  referencia: string | null;
  emitente: string | null;
  data: Date | null;
}

interface DetalheXml {
  unidade: string;
  desconto: number;
  ipi: number;
  icmsSt: number;
}

async function carregarItens(pares: ParProduto[]): Promise<ItemBase[]> {
  const modelos = pares.map((p) => p.modelo);
  const refs = pares.map((p) => p.referencia);
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT i.id, i."noteId" AS note_id,
           regexp_replace(i."codigoProduto", '[^[:print:]]', ' ', 'g') AS codigo,
           regexp_replace(i."descricao", '[^[:print:]]', ' ', 'g') AS descricao,
           i.ean, i.ncm,
           regexp_replace(COALESCE(i."infAdProd", ''), '[^[:print:]]', ' ', 'g') AS inf_ad,
           i.quantidade::float8 AS qtd, i."valorUnitario"::float8 AS vun, i."valorTotal"::float8 AS vtot,
           i."modeloIdentificado" AS modelo, i."referenciaFornecedorIdentificada" AS referencia,
           regexp_replace(COALESCE(n."emitenteNome", ''), '[^[:print:]]', ' ', 'g') AS emitente,
           n."dataEmissao" AS data
    FROM "NotaItem" i
    JOIN "Note" n ON n.id = i."noteId"
    JOIN unnest(${modelos}::text[], ${refs}::text[]) AS p(m, r)
      ON p.m IS NOT DISTINCT FROM i."modeloIdentificado"
     AND p.r IS NOT DISTINCT FROM i."referenciaFornecedorIdentificada"
    WHERE i."temCadastro" = false
    ORDER BY n."dataEmissao" DESC NULLS LAST, i.id
  `);
  return rows.map((r) => ({
    id: r.id,
    noteId: r.note_id,
    codigo: r.codigo ?? "",
    descricao: r.descricao ?? "",
    ean: r.ean,
    ncm: r.ncm,
    infAdProd: r.inf_ad || null,
    quantidade: Number(r.qtd),
    valorUnitario: Number(r.vun),
    valorTotal: Number(r.vtot),
    modelo: r.modelo,
    referencia: r.referencia,
    emitente: r.emitente || null,
    data: r.data,
  }));
}

/** Lê o XML das notas e devolve, por item, unidade/desconto/IPI/ICMS ST. */
async function detalhesDoXml(itens: ItemBase[]): Promise<Map<string, DetalheXml>> {
  const out = new Map<string, DetalheXml>();
  const porNota = new Map<string, ItemBase[]>();
  for (const it of itens) {
    const l = porNota.get(it.noteId) ?? [];
    l.push(it);
    porNota.set(it.noteId, l);
  }
  const ids = [...porNota.keys()];
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += 40) lotes.push(ids.slice(i, i + 40));

  const processar = async (lote: string[]) => {
    const notas = await prisma.$queryRaw<{ id: string; xml: string }[]>(Prisma.sql`
      SELECT id, "xmlCompleto" AS xml
      FROM "Note" WHERE id = ANY(${lote}::text[]) AND "xmlCompleto" <> ''
    `);
    for (const n of notas) {
      let nfe;
      try {
        nfe = parseNFeXml(n.xml.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " "));
      } catch {
        continue;
      }
      // casa NotaItem x item do XML por código + valor total + quantidade
      const disponiveis = [...nfe.itens];
      for (const it of porNota.get(n.id) ?? []) {
        const k = disponiveis.findIndex(
          (x) =>
            x.codigo.trim() === it.codigo.trim() &&
            Math.abs(Number(x.valorTotal) - it.valorTotal) < 0.005 &&
            Math.abs(Number(x.quantidade) - it.quantidade) < 0.0005
        );
        if (k < 0) continue;
        const x = disponiveis.splice(k, 1)[0];
        out.set(it.id, {
          unidade: (x.unidade || "").trim().toUpperCase(),
          desconto: Number(x.valorDesconto) || 0,
          ipi: Number(x.valorIpi) || 0,
          icmsSt: Number(x.valorIcmsSt) || 0,
        });
      }
    }
  };

  // 3 lotes por vez (sem estourar as conexões do banco gratuito).
  for (let i = 0; i < lotes.length; i += 3) {
    await Promise.all(lotes.slice(i, i + 3).map(processar));
  }
  return out;
}

/** Fornecedor do PDV mais usado por modelo (aprendido do catálogo já sincronizado). */
async function fornecedorPorModelo(modelos: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!modelos.length) return out;
  const rows = await prisma.$queryRaw<{ modelo: string; fornecedor: string }[]>(Prisma.sql`
    SELECT upper(trim("modeloNome")) AS modelo,
           mode() WITHIN GROUP (ORDER BY "fornecedorNome") AS fornecedor
    FROM "Produto"
    WHERE "fornecedorNome" IS NOT NULL AND trim("fornecedorNome") <> ''
      AND upper(trim("modeloNome")) = ANY(${modelos.map((m) => m.toUpperCase().trim())}::text[])
    GROUP BY 1
  `);
  for (const r of rows) out.set(r.modelo, r.fornecedor);
  return out;
}

function arred2(v: number) {
  return Math.round(v * 100) / 100;
}

/**
 * Lacoste: os dados vêm do LACOSTE.BIN via add-in dbsleek (que existe no Excel do
 * Hugo). Gera fórmulas (nomes em inglês, como o xlsx guarda) apontando para a
 * célula da ReferenciaFornecedor ($J) da própria linha.
 */
export function formulasLacoste(r: number) {
  const ref = `$J${r}`;
  const prod = `LEFT(TRIM(${ref}),SEARCH(".",TRIM(${ref}))-1)`;
  const cor3 = `RIGHT(TRIM(${ref}),3)&"%%"`;
  const prodSimples = `LEFT(${ref},SEARCH(".",${ref})-1)`;
  const tam = (n: number) =>
    `IFERROR(dbsleek("lista","lacoste.bin","codigo_barra","tamanho","produto","=",${prod},"cor_produto","=",${cor3},${n}),"")`;
  const tokens = Array.from({ length: 15 }, (_, i) => i + 1);
  const tamanhosJoin = `SUBSTITUTE(TRIM(${tokens.map((n) => tam(n)).join('&" "&')})," ",";")`;
  const tok = (n: number) => `TRIM(MID(SUBSTITUTE($L${r},";",REPT(" ",100)),${(n - 1) * 100 + 1},100))`;
  const ean = (n: number) =>
    `IF(${tok(n)}="","",IFERROR(dbsleek("MOSTRA","LACOSTE.BIN","CODIGO_BARRA","CODIGO_BARRA","produto","=",${prodSimples},"cor_produto","=",RIGHT(${ref},3)&"%%","tamanho","=",${tok(n)}),""))`;
  const eans = `SUBSTITUTE(TRIM(${tokens.map((n) => ean(n)).join('&" "&')})," ",";")`;
  const bin = (tab: string, col: string) =>
    `dbsleek("MOSTRA","LACOSTE.BIN","${tab}","${col}","${tab}","=",${prodSimples})`;
  return {
    linha: bin("PRODUTO", "TIPO"),
    colecao: bin("PRODUTO", "COLECAO"),
    cor: `dbsleek("MOSTRA","LACOSTE.BIN","PRODUTO_COR","DESC_COR_PRODUTO","PRODUTO_COR","=",${ref})`,
    tamanhos: tamanhosJoin,
    preco3: `ROUND(dbsleek("MOSTRA","LACOSTE.BIN","PRODUTO_COR","PRECO","PRODUTO_COR","=",${ref}),2)`,
    preco12: `ROUND(R${r}/2.4,2)`,
    comprador: bin("PRODUTO", "GRUPO"),
    eans,
  };
}

const PARAR_NOME = new Set([
  "POLIESTER", "POLIESTE", "LAM", "LAMINADO", "SINT", "SINTETICO", "PVC", "EVA", "PU", "TEXTIL",
  "COURO", "BORRACHA", "NEOPRENE", "FORRO", "DOTS", "TECIDO", "NYLON", "LONA", "ALGODAO",
  "MICROFIBRA", "ELASTANO", "+", "C/", "COM", "E",
]);

/** Kenner/Redley: separa nome do produto e cor da descrição da nota (null = não identificou). */
function nomeECorKenner(descricao: string, marca: string): { nome: string; cor: string } {
  let p = norm(descricao).replace(/\s+/g, " ").trim().split(" ");
  if (p.length > 1 && /^\d{1,3}$/.test(p[p.length - 1])) p = p.slice(0, -1); // tamanho final
  // cor: da palavra com "/" até o fim (ex.: CREPE/CAQUI BURBERRY)
  const iSlash = p.findIndex((w) => /^[A-Z]+\/[A-Z]+/.test(w));
  const cor = iSlash >= 0 ? p.slice(iSlash).join(" ") : "";
  const fim = iSlash >= 0 ? iSlash : p.length;
  const iMarca = p.findIndex((w) => w === marca);
  let nome = "";
  if (iMarca >= 0) {
    const t: string[] = [];
    for (let i = iMarca + 1; i < fim && t.length < 3; i++) {
      if (PARAR_NOME.has(p[i]) || /^\d+$/.test(p[i])) break;
      t.push(p[i]);
    }
    nome = t.join(" ");
  }
  return { nome, cor };
}

const PALAVRAS_SEM_COR = new Set(["IMP", "UN", "UNI", "UNICO", "UNICA"]);

/** 1ª palavra da descrição (CAMISETA vira TSHIRT). */
function primeiraPalavraGrupo(desc: string): string {
  const w = norm(desc).replace(/[^A-Z0-9 ]+/g, " ").trim().split(/\s+/)[0] ?? "";
  return w === "CAMISETA" ? "TSHIRT" : w;
}

/**
 * Hurley / Rip Curl: cor = o que vem depois de JUV/INF (se houver) ou a última
 * palavra da descrição sem o tamanho; cores de 2 palavras (OFF WHITE, BLUE BELL).
 */
const PREFIXO_COR = new Set(["OFF", "BLUE", "DARK", "LIGHT", "DEEP", "SKY", "NAVY"]);
function corUltimaPalavra(desc: string): string {
  const p = norm(desc).replace(/\s+/g, " ").trim().split(" ");
  const iJuv = p.findIndex((w) => ["JUV", "JUVENIL", "INF", "INFANTIL"].includes(w));
  if (iJuv >= 0 && iJuv < p.length - 1) return p.slice(iJuv + 1).join(" ");
  const u = p[p.length - 1] ?? "";
  if (p.length < 2 || !u || /^\d+$/.test(u) || PALAVRAS_SEM_COR.has(u)) return "";
  const ant = p[p.length - 2];
  return PREFIXO_COR.has(ant) ? `${ant} ${u}` : u;
}

/** Hurley / Rip Curl: Linha pelos tamanhos (P-GG e 36-48 = masculina; 8-16 ou JUV/INF = infanto). */
function linhaPorTamanhos(desc: string, tams: (string | null)[]): string {
  if (/\b(JUV|JUVENIL|INF|INFANTIL|KIDS?)\b/.test(norm(desc))) return "INFANTO";
  const ts = tams.filter((t): t is string => !!t);
  if (!ts.length) return "MASCULINA";
  const nums = ts.map((t) => (/^\d{1,2}$/.test(t.trim()) ? parseInt(t, 10) : NaN));
  if (nums.every((n) => !Number.isNaN(n))) {
    if (nums.every((n) => n >= 8 && n <= 16)) return "INFANTO";
    if (nums.every((n) => n >= 36 && n <= 48)) return "MASCULINA";
    return ""; // outro padrão numérico: a ensinar
  }
  return "MASCULINA"; // letras (P, M, G, GG, 2GG...) e UN
}

/** New Balance: "U9060R-TENIS NB 9060R UNISSEX-PTO/BCO-U906076M" -> grupo, linha, cor. */
function dadosNewBalance(desc: string): { grupo: string; linha: string; cor: string } {
  const seg = norm(desc).split("-").map((x) => x.trim());
  const rx = /\b(FEMININ[OA]|MASCULIN[OA]|UNISSEX|UNISEX)\b/;
  const i = seg.findIndex((x) => rx.test(x));
  if (i < 0) return { grupo: primeiraPalavraGrupo(seg[seg.length > 2 ? 1 : 0] ?? ""), linha: "", cor: "" };
  const w = seg[i].match(rx)![1];
  const linha = w.startsWith("FEM") ? "FEMININA" : w.startsWith("MASC") ? "MASCULINA" : "UNISSEX";
  const prox = seg[i + 1] ?? "";
  const cor = prox && !/\d/.test(prox) ? prox : "";
  return { grupo: primeiraPalavraGrupo(seg[i]), linha, cor };
}

/** Arredonda para o valor mais próximo que termina em 9,99 (mínimo 9,99). */
function fim999(v: number) {
  if (v <= 9.99) return 9.99;
  const k = Math.round((v - 9.99) / 10);
  return arred2(k * 10 + 9.99);
}

/** ME LEVA FARM: Grupo = 1ª palavra da descrição (PORTA JOIA = 2 palavras; MAXI/MINI são ignorados). */
function grupoMeLeva(desc: string): string {
  const p = norm(desc).replace(/[^A-Z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < p.length && (p[i] === "MAXI" || p[i] === "MINI")) i++;
  const w = p.slice(i);
  if (w[0] === "PORTA" && /^JOIAS?$/.test(w[1] ?? "")) return "PORTA JOIA";
  return w[0] ?? "";
}

function normalizarUnidade(u: string | undefined): string {
  const v = (u ?? "").trim().toUpperCase();
  if (!v) return "";
  if (["UND", "UNID", "UNIDADE", "UN."].includes(v)) return "UN";
  if (["PR", "PAR", "PARES"].includes(v)) return "PAR";
  if (["PÇ", "PEÇA", "PECA", "PCS", "PC"].includes(v)) return "PC";
  return v;
}

export async function gerarCadastroXlsx(
  pares: ParProduto[]
): Promise<{ buffer: Buffer; resumo: ResumoExportacao }> {
  const itens = pares.length ? await carregarItens(pares) : [];
  // ---- agrupa em linhas: modelo + referência + descrição sem tamanho --------
  interface ItemComTam extends ItemBase {
    tam: string | null; // tamanho já na grafia do PDV
    tamBruto: string | null;
  }
  const grupos = new Map<string, ItemComTam[]>();
  for (const it of itens) {
    const tamBruto =
      identificarTamanho({
        emitente: it.emitente ?? "",
        modelo: it.modelo,
        codigo: it.codigo,
        descricao: it.descricao,
        ean: it.ean,
        infAdProd: it.infAdProd,
        referencia: it.referencia,
      }) ??
      tamanhoGenerico({ codigo: it.codigo, descricao: it.descricao, infAdProd: it.infAdProd });
    // Lacoste: a regra antiga devolve a referência do fim da descrição, não o
    // tamanho. Só aceita se parecer tamanho de verdade (senão fica em branco).
    const tamBrutoOk =
      tamBruto && norm(it.modelo) === "LACOSTE" && !tamanhoPlausivel(tamBruto) ? null : tamBruto;
    const tam = tamBrutoOk ? canonicalizarTamanho(tamBrutoOk) : null;
    const desc = descricaoSemTamanho(it.descricao, tamBruto);
    const chave = JSON.stringify([it.modelo, it.referencia, desc]);
    const l = grupos.get(chave) ?? [];
    l.push({ ...it, tam, tamBruto: tamBrutoOk });
    grupos.set(chave, l);
  }

  // New Balance: cada loja paga um custo; o Preço 3 vale o do custo "padrão" (o
  // mais comum entre as notas; empate = o maior). Põe esse item na frente.
  for (const [, lista] of grupos) {
    if (norm(lista[0].modelo) !== "NEW BALANCE" || lista.length < 2) continue;
    const cont = new Map<number, number>();
    for (const i of lista) {
      const k = Math.round(i.valorUnitario * 100);
      cont.set(k, (cont.get(k) ?? 0) + 1);
    }
    const [melhor] = [...cont.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const idx = lista.findIndex((i) => Math.round(i.valorUnitario * 100) === melhor);
    if (idx > 0) lista.unshift(...lista.splice(idx, 1));
  }

  // XML só do item mais recente de cada linha (era de todos) + fornecedores em paralelo.
  const [detalhes, fornPdv] = await Promise.all([
    detalhesDoXml([...grupos.values()].map((l) => l[0])),
    fornecedorPorModelo([...new Set(itens.map((i) => i.modelo).filter((m): m is string => !!m))]),
  ]);

  const resumo: ResumoExportacao = {
    produtosSelecionados: pares.length,
    linhas: 0,
    semTamanho: 0,
    semEan: 0,
    eanRepetido: 0,
    fornecedorDoPdv: 0,
    fornecedorDaNota: 0,
  };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet");
  ws.addRow([...COLUNAS_CADASTRO]);
  ws.getRow(1).font = { bold: true };
  // colunas que precisam continuar como TEXTO (zeros à esquerda, sem notação científica)
  for (const nome of ["Referencia", "ReferenciaFornecedor", "NCM", "CEST", "EANs", "Tamanhos"]) {
    ws.getColumn(COLUNAS_CADASTRO.indexOf(nome as any) + 1).numFmt = "@";
  }
  ws.columns.forEach((c, i) => (c.width = Math.max(12, COLUNAS_CADASTRO[i].length + 2)));
  ws.getColumn(COLUNAS_CADASTRO.indexOf("Descricao") + 1).width = 48;

  const eansVistos = new Map<string, number>();
  const linhas: any[][] = [];

  for (const [chave, lista] of grupos) {
    const [modelo, referencia, descricao] = JSON.parse(chave) as [string | null, string | null, string];
    const maisRecente = lista[0]; // já vem ordenado por data desc
    const emitente = maisRecente.emitente ?? "";
    const ehAdidas = norm(emitente).includes("ADIDAS");
    const texto = `${descricao} ${modelo ?? ""}`;

    // ---- tamanhos e EANs (mesma ordem; um EAN por tamanho) -------------------
    const todosComTamanho = lista.every((i) => !!i.tam);
    let tamanhos = "";
    let eans = "";
    let eanFaltando = false;
    if (todosComTamanho) {
      const porTam = new Map<string, string>();
      for (const it of lista) {
        const t = it.tam!;
        const ean = /^\d{8,14}$/.test(it.ean ?? "") ? it.ean! : "";
        if (!porTam.has(t) || (!porTam.get(t) && ean)) porTam.set(t, ean);
      }
      const ordem = [...porTam.keys()].sort(compararTamanhos);
      tamanhos = ordem.join(";");
      eans = ordem.map((t) => porTam.get(t) ?? "").join(";");
      eanFaltando = ordem.some((t) => !porTam.get(t));
      if (eanFaltando) resumo.semEan++;
      for (const t of ordem) {
        const e = porTam.get(t);
        if (e) eansVistos.set(e, (eansVistos.get(e) ?? 0) + 1);
      }
    } else {
      resumo.semTamanho++;
    }

    // ---- regras por modelo (Grupo, Linha, Cor) --------------------------------
    const modeloU = norm(modelo);
    let grupo = "";
    let linha = "";
    let cor = "";
    let colecao = "";
    if (modeloU === "LACOSTE") {
      const tg = tipoEGrupoLacoste(descricao);
      if (tg) {
        grupo = tg.grupo;
        linha = tg.tipo;
      }
    } else if (modeloU === "ME LEVA FARM") {
      grupo = grupoMeLeva(descricao);
      linha = "FEMININA";
      cor = "UNICA";
    }
    let nomeProd = "";
    const ehKennerRedley = modeloU.includes("KENNER") || modeloU.includes("REDLEY");
    if (ehKennerRedley) {
      const r = nomeECorKenner(descricao, modeloU.includes("KENNER") ? "KENNER" : "REDLEY");
      nomeProd = r.nome;
      cor = r.cor;
      linha = "UNISSEX";
      colecao = "PERMANENTE";
    }
    const ehHurleyRC = modeloU === "HURLEY" || modeloU === "RIP CURL";
    if (ehHurleyRC) {
      grupo = primeiraPalavraGrupo(descricao);
      cor = corUltimaPalavra(descricao);
      linha = linhaPorTamanhos(descricao, lista.map((i) => i.tam));
    } else if (modeloU === "NEW BALANCE") {
      const nb = dadosNewBalance(descricao);
      grupo = nb.grupo;
      linha = nb.linha;
      cor = nb.cor;
      if (grupo === "TENIS" || grupo === "CHINELO") colecao = "PERMANENTE";
    }
    // ME LEVA FARM: descrição da nota + código do produto na nota.
    // New Balance: sem o 1º trecho (antes do hífen), sem hífens, sem o tamanho, + código da nota no fim.
    let descricaoFinal = descricao;
    if (modeloU === "ME LEVA FARM") descricaoFinal = `${descricao} ${maisRecente.codigo.trim()}`.trim();
    else if (modeloU === "NEW BALANCE") {
      const seg = descricao.split("-").map((x) => x.trim()).filter(Boolean);
      const meio = seg.length > 1 ? seg.slice(1) : seg;
      descricaoFinal = `${meio.join(" ")} ${maisRecente.codigo.trim()}`.replace(/\s+/g, " ").trim();
    }
    const comprador = grupo; // regra geral: Comprador = Grupo

    // ---- grade / unidade / tipo ------------------------------------------------
    const ehCalcado = grupo
      ? ["TENIS", "TENIS INF", "CHINELO"].includes(grupo)
      : temPalavra(texto, ["TENIS", "CHINELO", "SANDALIA", "SLIDE", "CHUTEIRA"]);
    const grade = ehCalcado ? "TENIS" : "PMG";
    const det = detalhes.get(maisRecente.id);
    // Unidade: calçado = PAR; roupa = PC; senão a da nota; sem unidade na nota = PC.
    let unidade: string;
    if (ehCalcado) unidade = "PAR";
    else if (temPalavra(texto, ROUPAS)) unidade = "PC";
    else unidade = normalizarUnidade(det?.unidade) || "PC";
    const tipoProduto = ehAdidas
      ? temPalavra(texto, ["BOLSA", "MOCHILA"]) ? 5 : 1
      : temPalavra(texto, ["MOCHILA", "CAMERA"]) || grupo === "MOCHILA" ? 5 : 1;

    // ---- fornecedor ------------------------------------------------------------
    let fornecedor = modelo ? fornPdv.get(modelo.toUpperCase().trim()) ?? "" : "";
    if (fornecedor) resumo.fornecedorDoPdv++;
    else {
      fornecedor = emitente;
      resumo.fornecedorDaNota++;
    }

    // ---- preços ----------------------------------------------------------------
    const qtd = maisRecente.quantidade || 1;
    const custoUn = maisRecente.valorUnitario;
    const custoTotUn = det
      ? (maisRecente.valorTotal - det.desconto + det.ipi + det.icmsSt) / qtd
      : null;
    // Cálculos com o valor cheio; só no fim arredonda para 2 casas.
    let preco1: number | null = custoUn;
    let preco2: number | null = custoTotUn;
    let preco3: number | null = null; // markup do modelo ainda não aprendido
    if (modeloU === "ME LEVA FARM") {
      preco1 = custoUn * 1.5;
      preco2 = custoTotUn == null ? null : custoTotUn * 1.5;
      preco3 = preco2 == null ? null : fim999(preco2 * 2.2);
    } else if (ehKennerRedley && preco2 != null) {
      // x2,5 ou x2,55: o que ficar mais perto de um valor terminado em 9,99
      const cand = [preco2 * 2.5, preco2 * 2.55].map((v) => ({ v, f: fim999(v) }));
      cand.sort((a, b) => Math.abs(a.v - a.f) - Math.abs(b.v - b.f));
      preco3 = cand[0].f;
    }
    const mult = modeloU === "HURLEY" ? 2.9 : modeloU === "RIP CURL" ? 2.4 : modeloU === "NEW BALANCE" ? 2.3 : 0;
    if (mult && preco2 != null) preco3 = fim999(preco2 * mult);
    preco1 = preco1 == null ? null : arred2(preco1);
    preco2 = preco2 == null ? null : arred2(preco2);
    preco3 = preco3 == null ? null : arred2(preco3);
    // Preco4: 0 para o que não é Flamengo/Fluminense. Fla/Flu: Preco3 + 10%
    // (adidas Fla e Puma repetem o Preco3); em branco enquanto o Preco3 não existe.
    const flaFlu = temPalavra(texto, ["FLAMENGO", "FLA", "CRF", "FLUMINENSE", "FLU"]);
    let preco4: number | null = 0;
    if (flaFlu) {
      if (preco3 == null) preco4 = null;
      else if (modeloU === "PUMA" || modeloU.includes("ADIDAS")) preco4 = preco3;
      else preco4 = arred2(preco3 * 1.1);
    }

    const ncm = soDigitos(maisRecente.ncm);
    const nova: any[] = [
      "", // Referencia: em branco -> o sistema gera a próxima referência da rede
      grupo,
      modelo ?? "",
      linha,
      colecao,
      fornecedor,
      grade,
      descricaoFinal,
      unidade,
      referencia ?? "",
      cor,
      tamanhos,
      TABELAS[0], preco1,
      TABELAS[1], preco2,
      TABELAS[2], preco3,
      TABELAS[3], preco4,
      TABELAS[4], 0,
      ncm.length === 8 ? ncm : "",
      "", // CEST: sempre vazio
      eans,
      tipoProduto,
      comprador,
    ];
    (nova as any).nomeProd = nomeProd;
    linhas.push(nova);
  }

  // ordena por modelo, referência, descrição
  linhas.sort(
    (a, b) =>
      String(a[2]).localeCompare(String(b[2]), "pt-BR") ||
      String(a[9]).localeCompare(String(b[9]), "pt-BR") ||
      String(a[7]).localeCompare(String(b[7]), "pt-BR")
  );
  for (const l of linhas) {
    const row = ws.addRow(l.map((v) => (typeof v === "string" ? v.toUpperCase() : v)));
    // Comprador (SubGrupo) = Grupo, como fórmula (=B2, =B3...); Lacoste usa o GRUPO do BIN
    const cc = row.getCell(27);
    cc.numFmt = "General";
    cc.value = { formula: `B${row.number}` } as any;
    const mU = norm(String(l[2]));
    // Descrição padrão (fórmula): GRUPO [NOME] REFERENCIAFORNECEDOR COR MODELO.
    // Exceções: ME LEVA FARM e NEW BALANCE (descrição montada a partir da nota, valor fixo).
    if (mU !== "ME LEVA FARM" && mU !== "NEW BALANCE") {
      const n = row.number;
      const lit = (t: unknown) => `"${String(t ?? "").replace(/"/g, "")}"`;
      const inicio = `B${n}`;
      const nome = (l as any).nomeProd ? `${lit((l as any).nomeProd)}&" "&` : "";
      const c = row.getCell(8);
      c.numFmt = "General";
      c.value = { formula: `TRIM(${inicio}&" "&${nome}J${n}&" "&K${n}&" "&C${n})` } as any;
    }
    if (norm(String(l[2])) === "LACOSTE") {
      const f = formulasLacoste(row.number);
      const put = (col: number, formula: string) => {
        const c = row.getCell(col);
        c.numFmt = "General";
        c.value = { formula } as any;
      };
      put(4, f.linha);
      put(8, `B${row.number}&" "&J${row.number}&" "&K${row.number}&" "&C${row.number}`);
      put(5, f.colecao);
      put(11, f.cor);
      put(12, f.tamanhos);
      put(14, f.preco12);
      put(16, f.preco12);
      put(18, f.preco3);
      put(25, f.eans);
      put(27, f.comprador); // Lacoste: Comprador = GRUPO do BIN (não =B)
    }
  }
  // Células vazias que precisam ser preenchidas: fundo amarelo (Referencia fica
  // vazia de propósito: o sistema gera a próxima).
  const amarelo = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2A8" } } as const;
  ws.eachRow((row, n) => {
    if (n === 1) return;
    for (let c = 2; c <= COLUNAS_CADASTRO.length; c++) {
      if (COLUNAS_CADASTRO[c - 1] === "CEST") continue; // CEST vazio é normal: sem amarelo
      const cell = row.getCell(c);
      const v: any = cell.value;
      if (v == null || v === "") cell.fill = amarelo as any;
    }
  });
  resumo.linhas = linhas.length;
  resumo.eanRepetido = [...eansVistos.values()].filter((n) => n > 1).length;

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, resumo };
}

/** CADASTRO_27_10_2026__16_41 (dia_mês_ano__hora_minuto, horário de Brasília). */
export function nomeArquivoCadastro(d = new Date()): string {
  const p = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const hh = g("hour") === "24" ? "00" : g("hour");
  return `CADASTRO_${g("day")}_${g("month")}_${g("year")}__${hh}_${g("minute")}.xlsx`;
}
