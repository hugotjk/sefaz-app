import { PRECOS_OAKLEY } from "@/lib/oakley-base";

/** Regras de preço por modelo — usadas no cadastro (planilha) e na Conferência de MKP. */

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = (s: string | null | undefined) => semAcento(s ?? "").toUpperCase();

export function arred2(v: number) {
  return Math.round(v * 100) / 100;
}

/** Arredonda para o valor mais próximo que termina em 9,99 (mínimo 9,99). */
export function fim999(v: number) {
  if (v <= 9.99) return 9.99;
  const k = Math.round((v - 9.99) / 10);
  return arred2(k * 10 + 9.99);
}

const MULT_FIXO: Record<string, number> = { HURLEY: 2.9, "RIP CURL": 2.4, "NEW BALANCE": 2.3 };

/** O modelo tem regra de preço (Preço 3) ensinada? */
export function modeloTemRegraDePreco(modelo: string | null | undefined): boolean {
  const m = norm(modelo);
  return (
    m === "ME LEVA FARM" ||
    m.includes("KENNER") ||
    m.includes("REDLEY") ||
    m === "OAKLEY" ||
    m in MULT_FIXO
  );
}

export interface PrecosModelo {
  preco1: number | null; // custo da nota (bruto)
  preco2: number | null; // custo total (desconto, IPI e ST)
  preco3: number | null; // preço de venda esperado
  multiplicador: number | null; // markup efetivamente aplicado sobre o Preço 2
}

/**
 * Preço 1/2/3 a partir do custo unitário da nota (`custoUn`) e do custo total
 * unitário (`custoTotUn` = valor - desconto + IPI + ST, por unidade). Os cálculos
 * usam o valor cheio; só no fim arredonda para 2 casas.
 */
export function calcularPrecosModelo(a: {
  modelo: string | null | undefined;
  emitente: string | null | undefined;
  referencia: string | null | undefined;
  custoUn: number;
  custoTotUn: number | null;
}): PrecosModelo {
  const modeloU = norm(a.modelo);
  const ehKennerRedley = modeloU.includes("KENNER") || modeloU.includes("REDLEY");
  let preco1: number | null = a.custoUn;
  let preco2: number | null = a.custoTotUn;
  let preco3: number | null = null; // markup do modelo ainda não aprendido
  if (modeloU === "ME LEVA FARM") {
    // Faturado pela CIDADE MARAVILHOSA: Preço 1 = NF e Preço 2 = custo+impostos-desconto
    // (sem multiplicar); nos demais fornecedores os dois levam x1,50.
    const fator = norm(a.emitente).includes("CIDADE MARAVILHOSA") ? 1 : 1.5;
    preco1 = a.custoUn * fator;
    preco2 = a.custoTotUn == null ? null : a.custoTotUn * fator;
    preco3 = preco2 == null ? null : fim999(preco2 * 2.2);
  } else if (ehKennerRedley && preco2 != null) {
    // x2,5 ou x2,55: o que ficar mais perto de um valor terminado em 9,99
    const cand = [preco2 * 2.5, preco2 * 2.55].map((v) => ({ v, f: fim999(v) }));
    cand.sort((x, y) => Math.abs(x.v - x.f) - Math.abs(y.v - y.f));
    preco3 = cand[0].f;
  }
  if (modeloU === "OAKLEY") {
    // Preço 3: "PDV R$" da planilha da Oakley (estilo = 9 primeiros caracteres); sem o
    // estilo, markup sobre o Preço 2 (roupa FOA x2,72; calçado/óculos FOF x2,45). Termina em ,99.
    const estilo = norm(a.referencia).replace(/\s+/g, "").slice(0, 9);
    const tabela = PRECOS_OAKLEY[estilo];
    if (tabela != null) preco3 = fim999(tabela);
    else if (preco2 != null) {
      const m = estilo.startsWith("FOA") ? 2.72 : estilo.startsWith("FOF") ? 2.45 : 0;
      if (m) preco3 = fim999(preco2 * m);
    }
  }
  const mult = MULT_FIXO[modeloU] ?? 0;
  if (mult && preco2 != null) preco3 = fim999(preco2 * mult);
  return {
    preco1: preco1 == null ? null : arred2(preco1),
    preco2: preco2 == null ? null : arred2(preco2),
    preco3: preco3 == null ? null : arred2(preco3),
    multiplicador: mult || null,
  };
}
