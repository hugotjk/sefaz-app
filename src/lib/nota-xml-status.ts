/**
 * Regras compartilhadas sobre o estado do XML completo de uma nota.
 * Usado pelo job `completarXmlNotas` (decide se ainda tenta) e pela rota
 * `/api/notas` (decide como mostrar na tela).
 */

// Depois de tantas tentativas em que a SEFAZ só devolveu o resumo...
export const LIMITE_TENTATIVAS_XML = 5;
// ...e a nota já sendo mais antiga que isso, o job desiste dela.
export const DIAS_NOTA_RECENTE = 30;

// Um procNFe (documento completo) tem vários KB; um resNFe (resumo) ~0,5 KB.
export const TAMANHO_MINIMO_XML_COMPLETO = 2000;

export type StatusXml = "completo" | "aguardando" | "indisponivel";

export function statusXmlNota(args: {
  temXmlCompleto: boolean;
  tentativasXml: number;
  dataEmissao: Date | null;
}): StatusXml {
  if (args.temXmlCompleto) return "completo";

  const notaAntiga =
    args.dataEmissao != null &&
    args.dataEmissao.getTime() < Date.now() - DIAS_NOTA_RECENTE * 86_400_000;

  if (args.tentativasXml >= LIMITE_TENTATIVAS_XML && notaAntiga) {
    return "indisponivel";
  }
  return "aguardando";
}
