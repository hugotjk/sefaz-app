import type ExcelJS from "exceljs";

/**
 * Formatação condicional "Valores Duplicados" (mesmo realce padrão do Excel: fundo rosa, texto vinho)
 * na coluna da ReferenciaFornecedor, para enxergar na hora produtos repetidos. Vale também para linhas
 * que o usuário acrescentar depois (a regra cobre até a linha 5000); células vazias não são pintadas.
 */
export function realcarReferenciasDuplicadas(ws: ExcelJS.Worksheet, coluna = "J", ate = 5000) {
  ws.addConditionalFormatting({
    ref: `${coluna}2:${coluna}${ate}`,
    rules: [
      {
        type: "expression",
        priority: 1,
        formulae: [`AND(${coluna}2<>"",COUNTIF($${coluna}$2:$${coluna}$${ate},${coluna}2)>1)`],
        style: {
          fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFC7CE" } },
          font: { color: { argb: "FF9C0006" } },
        },
      },
    ],
  });
}
