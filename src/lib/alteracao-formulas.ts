/** Fórmulas dbsleek da planilha de Alteração de Cadastro — idênticas ao modelo (sem dependência do banco). */

export const COLUNAS_ALTERACAO = [
  "Referencia", "Grupo", "Modelo", "Linha", "Colecao", "Fornecedor", "Grade", "Descricao", "Unidade",
  "ReferenciaFornecedor", "Cor", "Tamanhos", "TabelaPreco1", "Preco1", "TabelaPreco2", "Preco2",
  "TabelaPreco3", "Preco3", "TabelaPreco4", "Preco4", "TabelaPreco5", "Preco5", "NCM", "CEST", "EANs",
  "TipoProduto", "Comprador (SubGrupo)",
];

const MOSTRA = (campo: string, n: number) =>
  `_xll.dbsleek("MOSTRA","DBASE.BIN","PRODUTOS",${campo},"REFERENCIA","=",$A${n},"REDE","=","MULTI")`;
const tam = (n: number, i: number) =>
  `_xll.dbsleek("lista","dbase.bin","produtos","tamanho","referencia","=",$A${n},"rede","=","multi",${i})`;
const ean = (n: number, i: number) =>
  `IFERROR(_xll.dbsleek("mostra","dbase.bin","produtos","ean","referencia","=",$A${n},"rede","=","multi","tamanho","=",${tam(n, i)}),"")`;
const juntar = (n: number, f: (n: number, i: number) => string) =>
  Array.from({ length: 15 }, (_, k) => f(n, k + 1)).join('&" "&');

export function formulaL(n: number) {
  const partes = Array.from({ length: 15 }, (_, k) => `IFERROR(${tam(n, k + 1)},"")`).join('&" "&');
  return `SUBSTITUTE(TRIM(${partes})," ",";")`;
}
export function formulaY(n: number) {
  const miolo = `SUBSTITUTE(SUBSTITUTE(TRIM(${juntar(n, ean)})," ",";"),"[VAZIO]","")`;
  const teste = `SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(TRIM(${juntar(n, ean)})," ",";"),"[VAZIO]",""),";","")`;
  return `IF(${teste}="","",${miolo})`;
}
export function formulaZ(n: number) {
  const t = MOSTRA('"TIPO_PRODUTO"', n);
  return `_xlfn.IFS(${t}="PADRAO",1,${t}="SUBST TRIBUTARIA",5)`;
}

/** Fórmulas por coluna (1-based) para a linha n — idênticas ao modelo. */
export function formulasDaLinha(n: number): Record<number, { f: string; array: boolean }> {
  const out: Record<number, { f: string; array: boolean }> = {};
  for (const col of [2, 3, 4, 5, 6, 7, 8, 11, 23]) {
    const letra = String.fromCharCode(64 + col);
    out[col] = { f: MOSTRA(`${letra}$1`, n), array: true };
  }
  out[10] = { f: MOSTRA('"REFERENCIA_FORNECEDOR"', n), array: true };
  out[12] = { f: formulaL(n), array: false };
  out[25] = { f: formulaY(n), array: false };
  out[26] = { f: formulaZ(n), array: true };
  out[27] = { f: MOSTRA('"SUBGRUPO"', n), array: true };
  return out;
}

export const REDE_MULTI = 2;
