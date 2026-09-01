/**
 * Classifica a "Tipo Loja" (marca) de uma filial SÓ pelo nome — a API do PDV
 * não tem um campo confiável pra isso (nem `Empresa` nem `Grupo` da filial
 * mapeiam a marca). Rede NÃO é usada aqui de propósito: é uma agrupação de
 * sistema, não a marca.
 *
 * Retorna o nome da marca ou `null` quando o nome não tem nenhum token
 * conhecido (exceção manual, sem solução automática por enquanto).
 */

// 1. Exceções conhecidas por lojaId (nome não tem padrão que dê pra deduzir).
const EXCECOES_POR_LOJA_ID: Record<number, string> = {
  698: "MARACANA",
  833: "MARACANA",
  879: "FLUMINENSE", // "INATIVA MARACANA MF LESTE SUP. ESQUERDA" — é Fluminense
};

// 2. Tokens no nome (palavra inteira, maiúsculo). Ordem = prioridade: o
//    primeiro da lista que aparecer no nome vence.
const TOKENS: ReadonlyArray<readonly [string, string]> = [
  ["FLA", "FLAMENGO"],
  ["FLU", "FLUMINENSE"],
  ["BS", "BOARD SESSION"],
  ["WQ", "WQSURF"],
  ["WQS", "WQSURF"],
  ["55", "55RJ"],
  ["LCT", "LACOSTE"],
  ["FUT", "FUTTEBOL"],
  ["ACTD", "ACTITUD"],
  ["SANDALS", "SANDALS & CO"],
  ["EPLAI", "EPLAI"],
];

export function classificarTipoLoja(lojaId: number, nome: string): string | null {
  const excecao = EXCECOES_POR_LOJA_ID[lojaId];
  if (excecao) return excecao;

  const upper = (nome ?? "").toUpperCase();
  // Palavras do nome, com dígitos no fim removidos ("FLA2" -> "FLA", "WQ2" ->
  // "WQ"). Sufixos tipo NAOUSAR/INATIVA/FINANCEIRO e números de sequência
  // simplesmente não casam nenhum token e são ignorados na prática.
  const palavras = new Set(
    upper
      .split(/\s+/)
      .filter(Boolean)
      // "FLA2" -> "FLA", "WQ2" -> "WQ"; mas palavra só de dígitos ("55") fica.
      .map((p) => p.replace(/\d+$/, "") || p)
  );

  for (const [token, marca] of TOKENS) {
    if (palavras.has(token)) return marca;
  }

  // 3. Sem token conhecido, mas nome menciona o Maracanã -> é Flamengo
  //    (padrão real; as 2 exceções reais já foram tratadas no passo 1).
  if (upper.includes("MARACANA") || upper.includes("MARACA")) return "FLAMENGO";

  // 4. Nada bateu.
  return null;
}
