import type { TDocumentDefinitions, Content } from "pdfmake/interfaces";
import type { NFeParaExibir } from "@/lib/parse-nfe-xml";

// O entrypoint Node do pdfmake (classe PdfPrinter) não é coberto pelo
// @types/pdfmake (que tipa o build de browser), então carregamos via require.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PdfPrinter: new (fonts: Record<string, unknown>) => {
  createPdfKitDocument(
    doc: TDocumentDefinitions,
    opts?: { tableLayouts?: Record<string, unknown> }
  ): NodeJS.EventEmitter & { end(): void };
} = require("pdfmake");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const vfs: Record<string, string> = require("pdfmake/build/vfs_fonts.js");

const printer = new PdfPrinter({
  Roboto: {
    normal: Buffer.from(vfs["Roboto-Regular.ttf"], "base64"),
    bold: Buffer.from(vfs["Roboto-Medium.ttf"], "base64"),
    italics: Buffer.from(vfs["Roboto-Italic.ttf"], "base64"),
    bolditalics: Buffer.from(vfs["Roboto-MediumItalic.ttf"], "base64"),
  },
});

function moeda(v: string) {
  return Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}
function dataHora(iso: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR");
}
function dataCurta(iso: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR");
}
function chaveFormatada(chave: string) {
  return chave.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

/** Caixa rotulada (rótulo pequeno em cima, valor embaixo) — imita o DanfeView. */
function campo(label: string, value: string | number | null | undefined): Content {
  return {
    table: {
      widths: ["*"],
      body: [
        [
          {
            stack: [
              { text: label.toUpperCase(), style: "lbl" },
              { text: value == null || value === "" ? "-" : String(value), style: "val" },
            ],
          },
        ],
      ],
    },
    layout: "danfeBox",
  };
}

function secao(titulo: string): Content {
  return { text: titulo.toUpperCase(), style: "secao", margin: [0, 6, 0, 2] };
}

export async function gerarDanfePdf(nfe: NFeParaExibir): Promise<Buffer> {
  const itensBody = [
    [
      "Código",
      "Descrição",
      "NCM/SH",
      "CST",
      "CFOP",
      "Un",
      "Quant",
      "Vl. Unit.",
      "Vl. Total",
      "Vl. Desc.",
      "B. ICMS",
      "Vl. ICMS",
      "Vl. IPI",
      "Alíq ICMS",
      "Alíq IPI",
    ].map((t) => ({ text: t, style: "th" })),
    ...(nfe.itens.length
      ? nfe.itens.map((it) => [
          { text: it.codigo, style: "td" },
          { text: it.descricao, style: "tdLeft" },
          { text: it.ncm, style: "td" },
          { text: it.cst, style: "td" },
          { text: it.cfop, style: "td" },
          { text: it.unidade, style: "td" },
          { text: it.quantidade, style: "td" },
          { text: moeda(it.valorUnitario), style: "td" },
          { text: moeda(it.valorTotal), style: "td" },
          { text: moeda(it.valorDesconto), style: "td" },
          { text: moeda(it.baseCalcIcms), style: "td" },
          { text: moeda(it.valorIcms), style: "td" },
          { text: moeda(it.valorIpi), style: "td" },
          { text: it.aliqIcms, style: "td" },
          { text: it.aliqIpi, style: "td" },
        ])
      : [[{ text: "Sem itens no XML.", colSpan: 15, style: "td" }, ...Array(14).fill({})]]),
  ];

  const content: Content[] = [
    // Cabeçalho: emitente | DANFE | Nº/Série | Chave
    {
      columns: [
        {
          width: "42%",
          stack: [
            { text: nfe.emitente.nome || "-", bold: true, fontSize: 11 },
            { text: nfe.emitente.endereco, fontSize: 8 },
            { text: `Fone/Fax: ${nfe.emitente.telefone}`, fontSize: 8 },
            { text: `CNPJ: ${nfe.emitente.cnpj}   IE: ${nfe.emitente.ie}`, fontSize: 8 },
          ],
        },
        {
          width: "16%",
          alignment: "center",
          stack: [
            { text: "DANFE", bold: true, fontSize: 10 },
            { text: "Documento Auxiliar da Nota Fiscal Eletrônica", fontSize: 6 },
            { text: nfe.tipoOperacao, fontSize: 7, margin: [0, 3, 0, 0] },
          ],
        },
        {
          width: "14%",
          alignment: "center",
          stack: [
            { text: `Nº ${nfe.numero}`, fontSize: 9 },
            { text: `Série ${nfe.serie}`, fontSize: 9 },
          ],
        },
        {
          width: "28%",
          stack: [
            { text: "CHAVE DE ACESSO", style: "lbl" },
            { text: chaveFormatada(nfe.chaveAcesso), fontSize: 8, font: "Roboto" },
            {
              text: "Consulta em www.nfe.fazenda.gov.br/portal",
              fontSize: 6,
              margin: [0, 2, 0, 0],
            },
          ],
        },
      ],
      columnGap: 6,
      margin: [0, 0, 0, 6],
    },

    { columns: [campo("Natureza da Operação", nfe.natOp), campo(
      "Protocolo de Autorização de Uso",
      nfe.protocolo ? `${nfe.protocolo} - ${dataHora(nfe.dataAutorizacao)}` : "-"
    )], columnGap: 4 },

    secao("Destinatário / Remetente"),
    {
      columns: [
        campo("Nome / Razão Social", nfe.destinatario.nome),
        campo("CNPJ / CPF", nfe.destinatario.cnpjCpf),
        campo("Data da Emissão", dataCurta(nfe.dataEmissao)),
      ],
      columnGap: 4,
    },
    {
      columns: [
        campo("Endereço", nfe.destinatario.endereco),
        campo("Bairro", nfe.destinatario.bairro),
        campo("CEP", nfe.destinatario.cep),
        campo("Inscrição Estadual", nfe.destinatario.ie),
      ],
      columnGap: 4,
    },
    {
      columns: [
        campo("Município", nfe.destinatario.municipio),
        campo("UF", nfe.destinatario.uf),
        campo("Fone/Fax", nfe.destinatario.telefone),
      ],
      columnGap: 4,
    },
  ];

  if (nfe.transportador.nome || nfe.transportador.volumes !== "0") {
    content.push(
      secao("Transportador / Volumes Transportados"),
      {
        columns: [
          campo("Nome / Razão Social", nfe.transportador.nome),
          campo("Frete por Conta", nfe.transportador.modFrete),
          campo("CNPJ / CPF", nfe.transportador.cnpj),
        ],
        columnGap: 4,
      },
      {
        columns: [
          campo("Quantidade", nfe.transportador.volumes),
          campo("Espécie", nfe.transportador.especie),
          campo("Marca", nfe.transportador.marca),
          campo("Peso Bruto", nfe.transportador.pesoBruto),
          campo("Peso Líquido", nfe.transportador.pesoLiquido),
        ],
        columnGap: 4,
      }
    );
  }

  if (nfe.duplicatas.length > 0) {
    content.push(secao("Fatura / Duplicata"), {
      columns: nfe.duplicatas
        .slice(0, 8)
        .map((d) => campo(`Num. ${d.numero}`, `Venc. ${dataCurta(d.vencimento)} — R$ ${moeda(d.valor)}`)),
      columnGap: 4,
    });
  }

  content.push(
    secao("Cálculo do Imposto"),
    {
      columns: [
        campo("Base de Cálc. do ICMS", `R$ ${moeda(nfe.totais.baseCalcIcms)}`),
        campo("Valor do ICMS", `R$ ${moeda(nfe.totais.valorIcms)}`),
        campo("Base Cálc. ICMS S.T.", `R$ ${moeda(nfe.totais.baseCalcIcmsSt)}`),
        campo("Valor ICMS Subst.", `R$ ${moeda(nfe.totais.valorIcmsSt)}`),
      ],
      columnGap: 4,
    },
    {
      columns: [
        campo("Valor do Frete", `R$ ${moeda(nfe.totais.valorFrete)}`),
        campo("Valor do Seguro", `R$ ${moeda(nfe.totais.valorSeguro)}`),
        campo("Desconto", `R$ ${moeda(nfe.totais.valorDesconto)}`),
        campo("Outras Despesas", `R$ ${moeda(nfe.totais.outrasDespesas)}`),
      ],
      columnGap: 4,
    },
    {
      columns: [
        campo("Valor Total do IPI", `R$ ${moeda(nfe.totais.valorIpi)}`),
        campo("Valor do PIS", `R$ ${moeda(nfe.totais.valorPis)}`),
        campo("Valor da COFINS", `R$ ${moeda(nfe.totais.valorCofins)}`),
        campo("V. Total Produtos", `R$ ${moeda(nfe.totais.valorProdutos)}`),
      ],
      columnGap: 4,
    },
    {
      table: {
        widths: ["*"],
        body: [
          [
            {
              stack: [
                { text: "VALOR TOTAL DA NOTA", style: "lbl" },
                { text: `R$ ${moeda(nfe.totais.valorTotalNota)}`, bold: true, fontSize: 13 },
              ],
            },
          ],
        ],
      },
      layout: "danfeBox",
      margin: [0, 2, 0, 0],
    },

    secao("Dados dos Produtos / Serviços"),
    {
      table: {
        headerRows: 1,
        widths: [28, "*", 30, 18, 22, 14, 24, 32, 34, 30, 34, 30, 26, 26, 24],
        body: itensBody as any,
      },
      layout: "danfeGrid",
    }
  );

  if (nfe.informacoesComplementares) {
    content.push(secao("Dados Adicionais"), {
      table: { widths: ["*"], body: [[{ text: nfe.informacoesComplementares, fontSize: 7 }]] },
      layout: "danfeBox",
    });
  }

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [24, 24, 24, 24],
    defaultStyle: { font: "Roboto", fontSize: 8, color: "#111111" },
    styles: {
      lbl: { fontSize: 6, color: "#555555", characterSpacing: 0.2 },
      val: { fontSize: 9 },
      secao: { fontSize: 7, bold: true, color: "#333333" },
      th: { fontSize: 6, bold: true, alignment: "center", color: "#333333" },
      td: { fontSize: 6, alignment: "center" },
      tdLeft: { fontSize: 6, alignment: "left" },
    },
    content,
  };

  const pdfDoc = printer.createPdfKitDocument(doc, {
    tableLayouts: {
      danfeBox: {
        hLineWidth: () => 0.7,
        vLineWidth: () => 0.7,
        hLineColor: () => "#999999",
        vLineColor: () => "#999999",
        paddingLeft: () => 4,
        paddingRight: () => 4,
        paddingTop: () => 2,
        paddingBottom: () => 2,
      },
      danfeGrid: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => "#999999",
        vLineColor: () => "#999999",
        paddingLeft: () => 2,
        paddingRight: () => 2,
        paddingTop: () => 1,
        paddingBottom: () => 1,
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
