import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export interface NFeParaExibir {
  chaveAcesso: string;
  numero: string;
  serie: string;
  natOp: string;
  dataEmissao: string;
  protocolo: string;
  dataAutorizacao: string;
  emitente: { nome: string; cnpj: string; endereco: string };
  destinatario: { nome: string; cnpjCpf: string; endereco: string };
  itens: Array<{
    codigo: string;
    descricao: string;
    ncm: string;
    cfop: string;
    unidade: string;
    quantidade: string;
    valorUnitario: string;
    valorTotal: string;
  }>;
  totais: {
    valorProdutos: string;
    valorFrete: string;
    valorDesconto: string;
    valorTotalNota: string;
  };
}

function enderecoTexto(end: any): string {
  if (!end) return "";
  const partes = [end.xLgr, end.nro, end.xBairro, end.xMun, end.UF, end.CEP].filter(Boolean);
  return partes.join(", ");
}

export function parseNFeXml(xml: string): NFeParaExibir {
  const parsed = parser.parse(xml);
  const nfeProc = parsed.nfeProc ?? parsed; // pode vir com ou sem envelope nfeProc
  const infNFe = nfeProc.NFe?.infNFe ?? nfeProc.infNFe;
  const protNFe = nfeProc.protNFe?.infProt;

  const ide = infNFe.ide;
  const emit = infNFe.emit;
  const dest = infNFe.dest;
  const total = infNFe.total?.ICMSTot;

  const detRaw = infNFe.det;
  const detList = Array.isArray(detRaw) ? detRaw : [detRaw];

  return {
    chaveAcesso: infNFe["@_Id"]?.replace("NFe", "") ?? "",
    numero: String(ide?.nNF ?? ""),
    serie: String(ide?.serie ?? ""),
    natOp: String(ide?.natOp ?? ""),
    dataEmissao: String(ide?.dhEmi ?? ""),
    protocolo: String(protNFe?.nProt ?? ""),
    dataAutorizacao: String(protNFe?.dhRecbto ?? ""),
    emitente: {
      nome: String(emit?.xNome ?? ""),
      cnpj: String(emit?.CNPJ ?? ""),
      endereco: enderecoTexto(emit?.enderEmit),
    },
    destinatario: {
      nome: String(dest?.xNome ?? ""),
      cnpjCpf: String(dest?.CNPJ ?? dest?.CPF ?? ""),
      endereco: enderecoTexto(dest?.enderDest),
    },
    itens: detList.filter(Boolean).map((det: any) => ({
      codigo: String(det.prod?.cProd ?? ""),
      descricao: String(det.prod?.xProd ?? ""),
      ncm: String(det.prod?.NCM ?? ""),
      cfop: String(det.prod?.CFOP ?? ""),
      unidade: String(det.prod?.uCom ?? ""),
      quantidade: String(det.prod?.qCom ?? ""),
      valorUnitario: String(det.prod?.vUnCom ?? ""),
      valorTotal: String(det.prod?.vProd ?? ""),
    })),
    totais: {
      valorProdutos: String(total?.vProd ?? "0"),
      valorFrete: String(total?.vFrete ?? "0"),
      valorDesconto: String(total?.vDesc ?? "0"),
      valorTotalNota: String(total?.vNF ?? "0"),
    },
  };
}
