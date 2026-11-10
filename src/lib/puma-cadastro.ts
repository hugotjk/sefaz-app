/** Regras do cadastro de produtos PUMA (cor, nome do modelo do tênis e tamanho). */

/** Tamanho no fim da descrição -> grafia do PDV. */
const TAM_PUMA: Record<string, string> = {
  XXS: "2PP", "2XS": "2PP", XS: "PP", S: "P", M: "M", L: "G", XL: "GG", XXL: "2G", "2XL": "2G",
  XXXL: "3G", "3XL": "3G", ADULT: "UN", OPFA: "UN",
};
export function tamanhoPuma(token: string): string {
  const t = token.trim();
  return TAM_PUMA[t.toUpperCase()] ?? t;
}

const temMinuscula = (t: string) => /[a-zà-ú]/.test(t);

/** Limpa a cor: tira o "PUMA" do meio (PUMA White, White-PUMA Gold), troca GRAY por GREY. */
export function limparCorPuma(cor: string): string {
  return cor
    .replace(/\bPUMA\b/gi, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .replace(/\bGRAY\b/g, "GREY");
}

export interface DadosPuma {
  calcado: boolean;
  nome: string; // modelo do tênis (SHUFFLE DOWNTOWN); vazio nas roupas
  cor: string;
}

/**
 * Descrição original da nota (com maiúsculas/minúsculas), ex.:
 *  - "CALCADOS-SUEDE XL WILD WNS Vapor Gray-PUMA White 35" -> nome SUEDE XL WILD WNS, cor VAPOR GREY-WHITE
 *  - "... T Midnight Petrol XL"                             -> cor MIDNIGHT PETROL
 * O tamanho é a última palavra. A cor são as palavras com minúscula logo antes do tamanho.
 */
export function dadosPuma(descricaoOriginal: string): DadosPuma {
  let d = descricaoOriginal.replace(/\s+/g, " ").trim();
  const calcado = /^CALCADOS?\s*-/i.test(d);
  d = d.replace(/^CALCADOS?\s*-\s*/i, "");
  const tokens = d.split(" ");
  tokens.pop(); // tamanho
  if (!tokens.length) return { calcado, nome: "", cor: "" };
  if (calcado) {
    // modelo = palavras em maiúsculas até o "PUMA" ou a primeira palavra com minúscula (começa a cor)
    let i = tokens.findIndex((t) => t === "PUMA" || temMinuscula(t));
    if (i < 0) i = tokens.length;
    return { calcado, nome: tokens.slice(0, i).join(" "), cor: limparCorPuma(tokens.slice(i).join(" ")) };
  }
  let ini = tokens.length;
  while (ini > 0 && temMinuscula(tokens[ini - 1])) ini--;
  return { calcado, nome: "", cor: limparCorPuma(tokens.slice(ini).join(" ")) };
}
