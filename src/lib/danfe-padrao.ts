import type { TDocumentDefinitions, Content } from "pdfmake/interfaces";
import type { NFeParaExibir } from "@/lib/parse-nfe-xml";
import { code128C } from "@/lib/code128c";

/**
 * DANFE no layout "tradicional" (retrato, caixas com rótulo pequeno, fonte monoespaçada,
 * canhoto, código de barras, ISSQN e dados adicionais) — próximo ao que o PDVNet gera.
 * Usado na prévia e no DANFE das notas emitidas pelo Emissor de NFe.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PdfPrinter: new (fonts: Record<string, unknown>) => {
  createPdfKitDocument(doc: TDocumentDefinitions, opts?: { tableLayouts?: Record<string, unknown> }): NodeJS.EventEmitter & { end(): void };
} = require("pdfmake");

const printer = new PdfPrinter({
  Courier: { normal: "Courier", bold: "Courier-Bold", italics: "Courier-Oblique", bolditalics: "Courier-BoldOblique" },
});

const moeda = (v: string | undefined) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtd = (v: string) => Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const fmtCnpj = (c: string) =>
  c.length === 14 ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
  : c.length === 11 ? c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : c;
const partes = (iso: string | undefined) => {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return { data: "", hora: "", full: "" };
  const o = { timeZone: "America/Sao_Paulo" } as const;
  const data = d.toLocaleDateString("pt-BR", o);
  const hora = d.toLocaleTimeString("pt-BR", { ...o, hour: "2-digit", minute: "2-digit" });
  const full = `${data} ${d.toLocaleTimeString("pt-BR", { ...o, hour12: false })}`;
  return { data, hora, full };
};
const chaveFmt = (c: string) => c.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
const MOD_FRETE: Record<string, string> = {
  "0": "0 - Emitente", "1": "1 - Destinatário", "2": "2 - Terceiros", "3": "3 - Próprio (remetente)",
  "4": "4 - Próprio (destinatário)", "9": "9 - Sem frete",
};

type Opc = { align?: "left" | "right" | "center"; bold?: boolean; size?: number; span?: number };
function cel(label: string, valor: string | undefined, o: Opc = {}): any {
  const c: any = {
    stack: [
      { text: label.toUpperCase(), style: "lbl" },
      { text: valor == null || valor === "" ? " " : valor, style: "val", alignment: o.align ?? "left", bold: o.bold, fontSize: o.size },
    ],
  };
  if (o.span) c.colSpan = o.span;
  return c;
}
const vazias = (n: number) => Array(n).fill({});

function faixa(titulo: string): Content {
  return {
    table: { widths: ["*"], body: [[{ text: titulo.toUpperCase(), style: "faixa" }]] },
    layout: "semTopo",
  };
}
function tabela(widths: any[], rows: any[][], primeira = false, extra: any = {}): Content {
  return { table: { widths, body: rows, ...extra }, layout: primeira ? "caixa" : "semTopo" };
}

function codigoBarras(chave: string, largura: number, altura: number): any {
  if (!/^\d{44}$/.test(chave)) return { text: "", margin: [0, 0, 0, altura] };
  const mods = code128C(chave);
  const w = largura / mods.length;
  const rects: any[] = [];
  let i = 0;
  while (i < mods.length) {
    if (mods[i] === "1") {
      let j = i;
      while (j < mods.length && mods[j] === "1") j++;
      rects.push({ type: "rect", x: i * w, y: 0, w: (j - i) * w, h: altura, color: "#000000" });
      i = j;
    } else i++;
  }
  return { canvas: rects, margin: [0, 2, 0, 2] };
}

export async function gerarDanfePadrao(nfe: NFeParaExibir, opts: { previa?: boolean } = {}): Promise<Buffer> {
  const em = nfe.emitente, de = nfe.destinatario, tr = nfe.transportador, t = nfe.totais;
  const emissao = partes(nfe.dataEmissao);
  const saida = partes(nfe.dataSaida || nfe.dataEmissao);
  const autoriz = partes(nfe.dataAutorizacao);
  const protocolo = opts.previa ? "PRÉVIA - AINDA NÃO AUTORIZADA"
    : nfe.protocolo && nfe.protocolo !== "0" ? `${nfe.protocolo}   ${autoriz.full}` : " ";
  const tpNF = nfe.tipoOperacao.startsWith("0") ? "0" : "1";

  const content: Content[] = [];

  // ---- Canhoto
  content.push(
    tabela(["*", 90], [
      [{ text: `Recebemos de ${em.nome} - CNPJ: ${em.cnpj} - OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO`, style: "val", margin: [0, 2, 0, 2] },
       { stack: [{ text: "NF-e", bold: true, alignment: "center", fontSize: 8 }, { text: `Nº ${nfe.numero}`, bold: true, alignment: "center", fontSize: 8 }, { text: `SÉRIE ${nfe.serie}`, bold: true, alignment: "center", fontSize: 8 }], rowSpan: 2 }],
      [{ columns: [{ width: 120, text: "DATA DE RECEBIMENTO", style: "lbl", margin: [0, 4, 0, 10] }, { width: "*", text: "IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR", style: "lbl", margin: [0, 4, 0, 10] }] }, {}],
    ], true),
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 555, y2: 0, lineWidth: 0.6, dash: { length: 3 } }], margin: [0, 5, 0, 5] }
  );

  // ---- Cabeçalho: emitente | DANFE | barras
  const enderEmit = [
    em.endereco,
    [em.bairro && em.bairro !== "0" ? em.bairro : "", [em.municipio, em.uf].filter((x) => x && x !== "0").join(" - ")].filter(Boolean).join(" - "),
    em.cep && em.cep !== "0" ? `CEP:${em.cep}` : "",
  ].filter(Boolean);
  content.push(
    tabela([205, 95, "*"], [[
      { stack: [
          { text: em.nome, bold: true, fontSize: 9, margin: [4, 6, 4, 4] },
          ...enderEmit.map((l) => ({ text: l, fontSize: 7, bold: true, margin: [4, 0, 4, 1] })),
          { text: `Fone: ${em.telefone && em.telefone !== "0" ? em.telefone : ""}`, fontSize: 7, margin: [4, 8, 4, 2] },
        ] },
      { stack: [
          { text: "DANFE", bold: true, fontSize: 12, alignment: "center", margin: [0, 6, 0, 2] },
          { text: "Documento Auxiliar da Nota Fiscal Eletrônica", fontSize: 6, alignment: "center", margin: [2, 0, 2, 6] },
          { columns: [
              { width: "*", stack: [{ text: "0 - Entrada", fontSize: 7 }, { text: "1 - Saída", fontSize: 7 }] },
              { width: 22, table: { widths: [18], body: [[{ text: tpNF, alignment: "center", fontSize: 10, margin: [0, 2, 0, 2] }]] }, layout: "caixa" },
            ], margin: [8, 0, 8, 6] },
          { text: `Nº ${nfe.numero}`, bold: true, alignment: "center", fontSize: 8 },
          { text: `SÉRIE ${nfe.serie}`, bold: true, alignment: "center", fontSize: 8 },
          { text: "Página 1 de 1", bold: true, alignment: "center", fontSize: 7, margin: [0, 8, 0, 4] },
        ] },
      { stack: [
          { text: "CONTROLE DO FISCO", style: "lbl", margin: [2, 2, 0, 0] },
          { ...codigoBarras(nfe.chaveAcesso, 240, 38), margin: [8, 3, 0, 3] },
          { text: "CHAVE DE ACESSO", style: "lbl", margin: [2, 0, 0, 0] },
          { text: chaveFmt(nfe.chaveAcesso), bold: true, fontSize: 7.5, alignment: "center", margin: [0, 1, 0, 3] },
          { text: "CONSULTA DE AUTENTICIDADE NO PORTAL NACIONAL DA NF-E", style: "lbl", margin: [2, 0, 0, 0] },
          { text: "www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora", fontSize: 6.5, bold: true, alignment: "center", margin: [0, 1, 0, 3] },
          { text: "PROTOCOLO DE AUTORIZAÇÃO DE USO", style: "lbl", margin: [2, 0, 0, 0] },
          { text: protocolo, fontSize: 7.5, margin: [2, 1, 2, 3] },
        ] },
    ]]),
    tabela(["*"], [[cel("Natureza de Operação", nfe.natOp)]]),
    tabela(["*", 230, 160], [[cel("Inscrição Estadual", em.ie), cel("Inscrição Estadual do Subst. Tributário", ""), cel("CNPJ", fmtCnpj(em.cnpj))]]),
    faixa("Destinatário/Remetente"),
    tabela(["*", 120, 82], [[cel("Nome/Razão Social", de.nome), cel("CNPJ/CPF", fmtCnpj(de.cnpjCpf)), cel("Data da Emissão", emissao.data, { align: "right" })]]),
    tabela(["*", 120, 52, 82], [[cel("Endereço", de.endereco), cel("Bairro/Distrito", de.bairro), cel("CEP", de.cep), cel("Data Entrada/Saída", saida.data, { align: "right" })]]),
    tabela(["*", 50, 90, 30, 100, 82], [[cel("Município", de.municipio), cel("País", "Brasil"), cel("Fone/Fax", de.telefone === "0" ? "" : de.telefone), cel("UF", de.uf), cel("Inscrição Estadual", de.ie), cel("Hora Entrada/Saída", saida.hora, { align: "right" })]]),

    faixa("Cálculo do Imposto"),
    tabela(["*", "*", "*", "*", "*"], [[
      cel("Base de Cálculo do ICMS", moeda(t.baseCalcIcms), { align: "right" }), cel("Valor do ICMS", moeda(t.valorIcms), { align: "right" }),
      cel("Base de Cálc. ICMS Substituição", moeda(t.baseCalcIcmsSt), { align: "right" }), cel("Valor ICMS Substituição", moeda(t.valorIcmsSt), { align: "right" }),
      cel("Valor Total dos Produtos", moeda(t.valorProdutos), { align: "right" }),
    ]]),
    tabela(["*", "*", "*", "*", "*", "*"], [[
      cel("Valor do Frete", moeda(t.valorFrete), { align: "right" }), cel("Valor do Desconto", moeda(t.valorDesconto), { align: "right" }),
      cel("Outras Despesas", moeda(t.outrasDespesas), { align: "right" }), cel("Seguro", moeda(t.valorSeguro), { align: "right" }),
      cel("Valor do IPI", moeda(t.valorIpi), { align: "right" }), cel("Valor Total da Nota", moeda(t.valorTotalNota), { align: "right" }),
    ]]),

    faixa("Transportador/Volumes Transportados"),
    tabela(["*", 120, 70, 70, 100], [[
      cel("Razão Social", tr.nome === "0" ? "" : tr.nome), cel("Frete", MOD_FRETE[tr.modFrete] ?? tr.modFrete), cel("Código ANTT", ""), cel("Placa do Veículo UF", ""), cel("CNPJ/CPF", tr.cnpj === "0" ? "" : fmtCnpj(tr.cnpj)),
    ]]),
    tabela(["*", 150, 30, 120], [[cel("Endereço", tr.enderco === "0" ? "" : tr.enderco), cel("Município", tr.municipio === "0" ? "" : tr.municipio), cel("UF", tr.uf === "0" ? "" : tr.uf), cel("Inscrição Estadual", tr.ie === "0" ? "" : tr.ie)]]),
    tabela(["*", "*", "*", "*", 80, 80], [[
      cel("Quantidade", tr.volumes), cel("Espécie", tr.especie === "0" ? "" : tr.especie), cel("Marca", tr.marca === "0" ? "" : tr.marca),
      cel("Numeração", ""), cel("Peso Bruto", Number(tr.pesoBruto || 0).toFixed(2).replace(".", ",")), cel("Peso Líquido", Number(tr.pesoLiquido || 0).toFixed(2).replace(".", ",")),
    ]]),
  );

  // ---- Itens
  const th = (a: string, b = "") => ({ text: b ? `${a}\n${b}` : a, style: "th" });
  const itens = nfe.itens;
  const soma = (f: (i: (typeof itens)[number]) => string) => itens.reduce((s, i) => s + Number(f(i) || 0), 0);
  const corpo: any[][] = [
    [th("CÓD.PRODUTO"), th("DESCRIÇÃO DO PRODUTO", "SERVIÇO"), th("NCM", "SH"), th("CST", "CSOSN"), th("CFOP"), th("UNID"), th("QTDE"),
     th("VL.", "UNITÁRIO"), th("VL.", "DESC"), th("VL.", "TOTAL"), th("BC.", "ICMS"), th("VL.", "ICMS"), th("VL.", "IPI"), th("ALIQ.", "ICMS"), th("ALIQ.", "IPI")],
    ...itens.map((it) => [
      { text: it.codigo, style: "tdc" },
      { text: it.descricao + (it.infAdProd && it.infAdProd !== "0" ? `\n${it.infAdProd}` : ""), style: "tdl" },
      { text: it.ncm, style: "tdc" },
      { text: `${it.origem}${it.cst}`, style: "tdc" },
      { text: it.cfop, style: "tdc" },
      { text: it.unidade, style: "tdc" },
      { text: qtd(it.quantidade), style: "tdr" },
      { text: moeda(it.valorUnitario), style: "tdr" },
      { text: it.valorDesconto === "0" ? "" : moeda(it.valorDesconto), style: "tdr" },
      { text: moeda(it.valorTotal), style: "tdr" },
      { text: moeda(it.baseCalcIcms), style: "tdr" },
      { text: moeda(it.valorIcms), style: "tdr" },
      { text: it.valorIpi === "0" ? "" : moeda(it.valorIpi), style: "tdr" },
      { text: it.aliqIcms === "0" ? "" : moeda(it.aliqIcms), style: "tdr" },
      { text: it.aliqIpi === "0" ? "" : moeda(it.aliqIpi), style: "tdr" },
    ]),
  ];
  const idxEnchimento = corpo.length;
  corpo.push(Array.from({ length: 15 }, () => ({ text: " ", style: "tdc" })));
  corpo.push([
    { text: "Total", style: "tdl", bold: true }, { text: "" }, { text: "" }, { text: "" }, { text: "" }, { text: "" },
    { text: qtd(String(soma((i) => i.quantidade))), style: "tdr" }, { text: "" },
    { text: moeda(String(soma((i) => i.valorDesconto))), style: "tdr" }, { text: moeda(String(soma((i) => i.valorTotal))), style: "tdr" },
    { text: moeda(String(soma((i) => i.baseCalcIcms))), style: "tdr" }, { text: moeda(String(soma((i) => i.valorIcms))), style: "tdr" },
    { text: moeda(String(soma((i) => i.valorIpi))), style: "tdr" }, { text: "" }, { text: "" },
  ]);
  const alturaEnchimento = Math.max(0, 270 - itens.length * 22);

  content.push(
    faixa("Dados do Produto/Serviço"),
    {
      table: {
        headerRows: 1,
        widths: [40, "*", 34, 24, 24, 22, 24, 38, 28, 40, 34, 32, 26, 24, 24],
        heights: (row: number) => (row === idxEnchimento ? alturaEnchimento : undefined),
        body: corpo,
      } as any,
      layout: "grade",
    },
    faixa("Cálculo do ISSQN"),
    tabela([120, 130, 150, "*"], [[
      cel("Inscrição Municipal", em.im || "ISENTO"), cel("Valor Total dos Serviços", ""), cel("Base de Cálculo do ISSQN", ""), cel("Valor do ISSQN", ""),
    ]]),
    faixa("Dados Adicionais"),
    tabela(["*", 150], [[
      { stack: [{ text: "INFORMAÇÕES COMPLEMENTARES", style: "lbl" }, { text: nfe.informacoesComplementares === "0" ? " " : nfe.informacoesComplementares, fontSize: 8, margin: [0, 2, 0, 40] }] },
      { stack: [{ text: "RESERVADO AO FISCO", style: "lbl" }] },
    ]]),
  );

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [20, 20, 20, 20],
    ...(opts.previa
      ? { watermark: { text: "PRÉVIA - NÃO ENVIADA À SEFAZ", color: "#b45309", opacity: 0.15, bold: true, fontSize: 48 } }
      : nfe.ambiente === "2"
      ? { watermark: { text: "SEM VALOR FISCAL - HOMOLOGAÇÃO", color: "#cc0000", opacity: 0.12, bold: true, fontSize: 44 } }
      : {}),
    defaultStyle: { font: "Courier", fontSize: 8, color: "#000000" },
    styles: {
      lbl: { fontSize: 5.5, color: "#222222" },
      val: { fontSize: 8, bold: false },
      faixa: { fontSize: 6, bold: true, fillColor: "#e5e5e5", margin: [0, 1, 0, 1] },
      th: { fontSize: 5.5, bold: true, alignment: "center", fillColor: "#f0f0f0" },
      tdc: { fontSize: 6.5, alignment: "center" },
      tdl: { fontSize: 6.5, alignment: "left" },
      tdr: { fontSize: 6.5, alignment: "right" },
    },
    content,
  };

  const caixa = {
    hLineWidth: () => 0.8, vLineWidth: () => 0.8, hLineColor: () => "#000000", vLineColor: () => "#000000",
    paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 1, paddingBottom: () => 1,
  };
  const pdfDoc = printer.createPdfKitDocument(doc, {
    tableLayouts: {
      caixa,
      semTopo: { ...caixa, hLineWidth: (i: number) => (i === 0 ? 0 : 0.8) },
      grade: {
        ...caixa, hLineWidth: (i: number, node: any) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0),
        vLineWidth: () => 0.6, paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 2, paddingBottom: () => 2,
      },
    },
  });
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdfDoc.on("data", (c: Buffer) => chunks.push(c));
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
    pdfDoc.on("error", reject);
    pdfDoc.end();
  });
}
