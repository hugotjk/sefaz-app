/**
 * Havaianas (CD Comércio / Avacy): "HAVAIANAS TOP MIX 1373 BUTTERCREAM AMARELO CAJA 37/38".
 * Nome do modelo = o que vem depois de HAVAIANAS até a cor (entra na descrição do cadastro);
 * cor = o que vem depois do nome, antes do tamanho: 1 palavra (PRETO, PRETO/PRETO) ou 2 quando a
 * primeira é uma cor-base (AMARELO CAJA, ROSA FLUX, VERMELHO HIBISCO). Cor repetida vira uma só
 * (FERRUGEM FERRUGEM -> FERRUGEM). O grupo é sempre CHINELO.
 */
export const GRUPO_HAVAIANAS = "CHINELO";

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Cores-base que abrem uma cor de 2 palavras. Acrescente aqui quando aparecer uma nova. */
const CORES_BASE = new Set([
  "AMARELO", "ROSA", "VERMELHO", "AZUL", "VERDE", "LARANJA", "ROXO", "CINZA", "MARROM", "BEGE",
  "BRANCO", "PRETO", "DOURADO", "PRATA", "LILAS", "VINHO", "CORAL", "OFF", "NUDE", "TURQUESA",
  "MARINHO", "SALMAO", "MOSTARDA", "OLIVA", "TERRACOTA", "CARAMELO", "FERRUGEM",
]);

const ehTamanho = (t: string) => /^\d{2}(\/\d{2})?$/.test(t) || t === "UN";

export interface DadosHavaianas {
  nome: string;
  cor: string;
}

export function dadosHavaianas(descricao: string): DadosHavaianas {
  let tokens = semAcento(descricao).toUpperCase().replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const iMarca = tokens.indexOf("HAVAIANAS");
  if (iMarca >= 0) tokens = tokens.slice(iMarca + 1);
  while (tokens.length && ehTamanho(tokens[tokens.length - 1])) tokens.pop();
  // o código do modelo tem 4 dígitos (1373, 6978, 0090); a cor vem depois dele
  let iCod = tokens.findIndex((t) => /^\d{4}$/.test(t));
  if (iCod < 0) return { nome: tokens.join(" "), cor: "" };
  const depois = tokens.slice(iCod + 1);
  if (!depois.length) return { nome: tokens.join(" "), cor: "" };
  let nCor = 1;
  if (depois.length >= 2 && CORES_BASE.has(depois[depois.length - 2])) nCor = 2;
  let corTokens = depois.slice(depois.length - nCor);
  if (corTokens.length === 2 && corTokens[0] === corTokens[1]) corTokens = [corTokens[0]];
  const nome = tokens.slice(0, tokens.length - nCor).join(" ");
  return { nome, cor: corTokens.join(" ") };
}
