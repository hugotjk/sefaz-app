import { XMLParser } from "fast-xml-parser";
import type { DocumentoDistribuicao } from "./sefaz";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // CRÍTICO: sem isso, o parser converte a chave de acesso (44 dígitos) em
  // número JS, que perde precisão e vira notação científica — corrompendo
  // a chave. Mantemos tudo como string e convertemos manualmente onde precisa.
  parseTagValue: false,
});

// Tabela oficial de tpEvento -> tipo (as mais comuns para o caso de uso)
const TIPO_EVENTO_MAP: Record<string, string> = {
  "110110": "CARTA_CORRECAO",
  "110111": "CANCELAMENTO",
  "210200": "CONFIRMACAO_OPERACAO",
  "210210": "CIENCIA_OPERACAO",
  "210220": "DESCONHECIMENTO_OPERACAO",
  "210240": "OPERACAO_NAO_REALIZADA",
};

export interface ResumoNota {
  tipo: "nota";
  chaveAcesso: string;
  numero: string;
  serie: string;
  emitenteCnpj: string;
  emitenteNome: string;
  valorTotal: string;
  dataEmissao: string;
  status: "AUTORIZADA" | "CANCELADA" | "DENEGADA";
  nsu: string;
}

export interface ResumoEvento {
  tipo: "evento";
  chaveAcesso: string;
  tipoEvento: string;
  descricao: string;
  dataEvento: string;
  nsu: string;
}

export function parseDocumento(doc: DocumentoDistribuicao): ResumoNota | ResumoEvento | null {
  const parsed = parser.parse(doc.xml);

  if (doc.schema?.startsWith("resNFe")) {
    const r = parsed.resNFe;
    // cSitNFe: 1=Autorizada, 2=Cancelada, 3=Denegada
    const situacao = String(r.cSitNFe);
    const status = situacao === "2" ? "CANCELADA" : situacao === "3" ? "DENEGADA" : "AUTORIZADA";
    return {
      tipo: "nota",
      chaveAcesso: String(r.chNFe),
      numero: String(r.nNF ?? ""),
      serie: String(r.serie ?? ""),
      emitenteCnpj: String(r.CNPJ ?? r.CPF ?? ""),
      emitenteNome: String(r.xNome ?? ""),
      valorTotal: String(r.vNF ?? "0"),
      dataEmissao: String(r.dhEmi ?? ""),
      status,
      nsu: doc.nsu,
    };
  }

  if (doc.schema?.startsWith("resEve")) {
    const r = parsed.resEvento;
    const tpEvento = String(r.tpEvento);
    return {
      tipo: "evento",
      chaveAcesso: String(r.chNFe),
      tipoEvento: TIPO_EVENTO_MAP[tpEvento] ?? "OUTRO",
      descricao: String(r.xEvento ?? ""),
      dataEvento: String(r.dhEvento ?? ""),
      nsu: doc.nsu,
    };
  }

  // procNFe (XML completo) e outros schemas: tratados à parte quando necessário
  return null;
}
