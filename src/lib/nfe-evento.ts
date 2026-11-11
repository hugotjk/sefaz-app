/** Evento de cancelamento de NF-e (tpEvento 110111). Função pura: monta o XML sem assinatura. */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const MIN_JUSTIFICATIVA = 15;

export function montarCancelamento(p: {
  cnpj: string; chave: string; nProt: string; xJust: string; ambiente: 1 | 2; dataEvento?: Date;
}): string {
  const xJust = p.xJust.trim().replace(/\s+/g, " ");
  if (xJust.length < MIN_JUSTIFICATIVA) throw new Error(`A justificativa precisa ter no mínimo ${MIN_JUSTIFICATIVA} caracteres.`);
  if (xJust.length > 255) throw new Error("A justificativa pode ter no máximo 255 caracteres.");
  const dh = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(p.dataEvento ?? new Date()).replace(" ", "T") + "-03:00";
  const id = `ID110111${p.chave}01`;
  return (
    `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="${id}"><cOrgao>${p.chave.slice(0, 2)}</cOrgao>` +
    `<tpAmb>${p.ambiente}</tpAmb><CNPJ>${p.cnpj}</CNPJ><chNFe>${p.chave}</chNFe><dhEvento>${dh}</dhEvento><tpEvento>110111</tpEvento>` +
    `<nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento>` +
    `<nProt>${esc(p.nProt)}</nProt><xJust>${esc(xJust)}</xJust></detEvento></infEvento></evento>`
  );
}
