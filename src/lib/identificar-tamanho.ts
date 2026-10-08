/**
 * Identificação do TAMANHO do item da nota (port da fórmula do Excel do
 * cadastro). Cada fornecedor/modelo escreve o tamanho de um jeito (no código,
 * na descrição, nas informações do item); a regra é POR EMITENTE ou POR MODELO.
 *
 * Mapeamento das colunas da planilha (ASSUMIDO — confirmar com o usuário):
 *   $A = emitente, $G = código do produto na nota, $H = descrição,
 *   $I = EAN, $P = informações adicionais do item (infAdProd),
 *   $AA = referência do fornecedor, $AD = modelo.
 *
 * Retorna o tamanho já normalizado (XL->GG, L->G, S->P...) ou null quando
 * nenhuma regra cobre / a regra não achou o padrão. Ordem das regras = ordem
 * do SES do Excel (a primeira que casa vale).
 */
import { direita, esquerda, localizar, substituir, ultimoNome } from "./identificar-produto";

export interface EntradaTamanho {
  emitente: string; // $A
  modelo: string | null; // $AD
  codigo: string; // $G
  descricao: string; // $H
  ean?: string | null; // $I
  infAdProd?: string | null; // $P
  referencia?: string | null; // $AA
  /** Tabela EAN -> tamanho da adidas (a planilha usa PROCX em "Adidas_EAN"). */
  tamanhoPorEan?: (ean: string) => string | null | undefined;
}

const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const len = (t: string) => t.length;

/** Aplica SUBSTITUIR em sequência (o 1º par é o mais interno da fórmula). */
function cadeia(t: string, pares: [string, string][]): string {
  return pares.reduce((acc, [de, para]) => substituir(acc, de, para), t);
}

const GRADE_ROUPA_XS: [string, string][] = [
  ["4XL", "4G"], ["3XL", "3G"], ["2XL", "2G"], ["XL", "GG"], ["L", "G"],
  ["4XS", "4PP"], ["3XS", "3PP"], ["2XS", "2PP"], ["XS", "PP"], ["S", "P"],
];

type Regra = {
  quando: (e: EntradaTamanho) => boolean;
  valor: (e: EntradaTamanho) => string;
};

const porEmitente = (...nomes: string[]) => (e: EntradaTamanho) => nomes.some((n) => eq(e.emitente, n));
const porModelo = (...nomes: string[]) => (e: EntradaTamanho) => !!e.modelo && nomes.some((n) => eq(e.modelo!, n));

const ult = (t: string) => ultimoNome(t);

const REGRAS: Regra[] = [
  { quando: porEmitente("RIDE GROUP CALCADOS LTDA"), valor: (e) => direita(e.codigo, 2) },
  {
    quando: porEmitente("MATMAMAT CONFECCOES LTDA"),
    valor: (e) => {
      const H = e.descricao;
      const r = direita(H, len(H) - localizar("-", H) - 1);
      return esquerda(r, localizar("-", r) - 1);
    },
  },
  { quando: porEmitente("STAR FLEX CALCADOS LTDA"), valor: (e) => ult(e.descricao) },
  { quando: porEmitente("GRUPO INVENTI LTDA"), valor: (e) => substituir(e.codigo, esquerda(e.codigo, 9), "") },
  { quando: porEmitente("DMF DISTRIBUIDORA LTDA"), valor: () => "UN" },
  {
    quando: porEmitente("Avacy Distribuidora e Comercio de Calcados Ltda"),
    valor: (e) => (len(ult(e.descricao)) > 5 ? "UN" : ult(e.descricao)),
  },
  {
    quando: porModelo("Florence"),
    valor: (e) => {
      const H = e.descricao;
      const x = direita(H, len(H) - localizar("TAM", H) - 3);
      const sp = localizar(" ", x);
      return sp > 0 ? esquerda(x, sp) : x;
    },
  },
  {
    quando: porEmitente("BRUNO SENA XAVIER"),
    valor: (e) => {
      const u = ult(e.descricao);
      const x = direita(u, len(u) - localizar(":", u));
      return cadeia(x, [["3XL", "3G"], ["2XL", "2G"], ["XL", "GG"], ["L", "G"], ["S", "P"]]);
    },
  },
  { quando: porEmitente("HAF DISTRIBUIDOR LTDA", "BRUNX IND VESTUARIO LTDA"), valor: (e) => ult(e.descricao) },
  { quando: porModelo("ME LEVA FARM"), valor: () => "UN" },
  {
    quando: porEmitente("R DOIS INJETADOS NORDESTE LTDA", "R DOIS INJETADOS LTDA", "VEST SURF IND COM IMP E EXP DE ROUPAS LTDA."),
    valor: (e) => ult(e.descricao),
  },
  { quando: porModelo("Lacoste"), valor: (e) => substituir(ult(e.descricao), "TU", "UN") },
  {
    quando: porEmitente("NIRUT IND E COM CALC LTDA"),
    valor: (e) =>
      cadeia(direita(e.codigo, len(e.codigo) - localizar("-", e.codigo)), [
        ["3/4", "33/34"], ["5/6", "35/36"], ["7/8", "37/38"], ["9/0", "39/40"],
      ]),
  },
  {
    quando: porEmitente("DASS NORDESTE CALCADOS E ARTIGOS ESPORTIVOS S.A."),
    valor: (e) => substituir(direita(e.descricao, len(e.descricao) - localizar("Tam:", e.descricao)), "am:", ""),
  },
  { quando: porModelo("Jade Jade"), valor: (e) => ult(e.infAdProd ?? "") },
  {
    quando: porEmitente("ALPAR  DO BRASIL IND.COM.LTDA", "ALPAR DO BRASIL S/A"),
    valor: (e) => {
      const u = ult(e.infAdProd ?? "");
      const a = localizar("/", u);
      const r = direita(u, len(u) - a);
      const b = localizar("/", r);
      const v = b > 0 ? esquerda(u, len(u) - b) : esquerda(u, a - 1);
      return substituir(v, ",", ".");
    },
  },
  {
    quando: porEmitente("VIESS CALÇADOS E ARTIGOS ESPORTIVOS LTDA"),
    valor: (e) => {
      const P = e.infAdProd ?? "";
      const t = substituir(P, esquerda(P, localizar("BRA", P) + 3), "");
      return esquerda(t, localizar(".", t) - 1);
    },
  },
  { quando: porEmitente("1QA+ Confeccoes Eireli (Torcida Baby)"), valor: (e) => ult(e.descricao) },
  { quando: porEmitente("BRANDILI TEXTIL LTDA"), valor: (e) => substituir(e.codigo, e.referencia ?? "", "") },
  { quando: porEmitente("TECHNOS DA AMAZONIA IND. E COM. S/A"), valor: () => "UN" },
  { quando: porModelo("Reserva"), valor: (e) => direita(e.codigo, len(e.codigo) - 14) },
  { quando: porModelo("MCD", "LOST"), valor: (e) => substituir(ult(e.infAdProd ?? ""), "U", "UN") },
  { quando: porEmitente("NEW BRASIL ARTIGOS ESPORTIVOS LTDA"), valor: (e) => direita(e.descricao, 2) },
  {
    quando: porEmitente(
      "VULCABRAS DISTRIBUIDORA DE ARTIGOS ESPORTIVOS LTDA",
      "VULCABRAS BA CALCADOS E ARTIGOS ESPORTIVOS S.A.",
      "VULCABRAS - CE CALCADOS E ARTIGOS ESPORTIVOS S/A"
    ),
    valor: (e) => ult(e.descricao),
  },
  {
    quando: porEmitente("BRAZILINE INDUSTRIA E COMERCIO LTDA"),
    valor: (e) =>
      cadeia(direita(e.codigo, 2), [["PQ", "P"], ["MD", "M"], ["GR", "G"], ["GG", "GG"], ["UN", "2G"]]),
  },
  {
    quando: porEmitente("adidas do Brasil Ltda"),
    valor: (e) => {
      const base = e.ean && e.tamanhoPorEan ? e.tamanhoPorEan(e.ean) ?? "" : "";
      return cadeia(base, GRADE_ROUPA_XS);
    },
  },
  { quando: porModelo("Approve"), valor: (e) => ult(e.infAdProd ?? "") },
  { quando: porModelo("Baw"), valor: (e) => direita(e.codigo, len(e.codigo) - 10) },
  { quando: porModelo("Converse"), valor: (e) => ult(e.descricao) },
  { quando: porModelo("OUS", "Mormaii"), valor: (e) => ult(e.descricao) },
  { quando: porModelo("New Balance"), valor: (e) => esquerda(direita(e.codigo, 3), 2) },
  {
    quando: porModelo("High"),
    valor: (e) =>
      cadeia(direita(e.codigo, len(e.codigo) - localizar("-", e.codigo)), [
        ["XS", "PP"], ["S", "P"], ["XXL", "2G"], ["XL", "GG"], ["L", "G"], ["XXl", "2G"],
      ]),
  },
  { quando: porModelo("Kenner", "Redley"), valor: (e) => ult(e.descricao) },
  { quando: porModelo("Casio", "G-Shock"), valor: () => "UN" },
  { quando: porModelo("Vans"), valor: (e) => direita(e.codigo, len(e.codigo) - 15) },
  {
    quando: porModelo("OAKLEY"),
    valor: (e) => {
      const G = e.codigo;
      if (esquerda(G, 3).toUpperCase() === "0OO") return "UN";
      const h = localizar("-", G);
      if (h > 0) {
        return cadeia(direita(G, len(G) - h - 3), [["S", "P"], ["XXL", "3G"], ["XL", "GG"], ["L", "G"]]);
      }
      const sp = localizar(" ", G);
      if (sp > 0) {
        return cadeia(direita(G, len(G) - sp - 3), [
          ["S", "P"], ["XXXL", "3G"], ["XXL", "2G"], ["XL", "GG"], ["L", "G"], ["U", "UN"], ["UNN", "UN"],
        ]);
      }
      return "";
    },
  },
  {
    quando: porModelo("Champion"),
    valor: (e) =>
      cadeia(ult(e.descricao), [
        ["UNICO", "UN"], ["P/S", "P"], ["M/M", "M"], ["G/L", "G"], ["GG/XL", "GG"], ["XGG/2XL", "2G"], ["3XG/3XL", "3G"],
      ]),
  },
  { quando: porModelo("Rip Curl", "Hurley", "RVCA"), valor: (e) => ult(e.descricao) },
  {
    quando: porModelo("Fila"),
    valor: (e) => substituir(direita(e.descricao, len(e.descricao) - localizar(":", e.descricao)), "-", "/"),
  },
  {
    quando: porModelo("PUMA"),
    valor: (e) =>
      cadeia(ult(e.descricao), [
        ["S", "P"], ["Adult", "UN"], ["XXL", "2G"], ["XL", "GG"], ["OPFA", "UN"], ["L", "G"],
      ]),
  },
];

/** Tamanho normalizado do item, ou null se nenhuma regra cobre / não achou. */
export function identificarTamanho(e: EntradaTamanho): string | null {
  const regra = REGRAS.find((r) => r.quando(e));
  if (!regra) return null;
  try {
    const v = regra.valor(e).trim();
    return v ? v : null;
  } catch {
    return null;
  }
}

/** Há regra de tamanho para este emitente/modelo? (p/ listar o que falta aprender) */
export function temRegraTamanho(e: Pick<EntradaTamanho, "emitente" | "modelo">): boolean {
  return REGRAS.some((r) => r.quando({ ...e, codigo: "", descricao: "" }));
}
