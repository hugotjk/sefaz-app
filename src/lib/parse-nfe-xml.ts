import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false, // evita corromper a chave de acesso (44 dígitos)
  removeNSPrefix: true, // tolera XML com prefixo de namespace (ns2:NFe etc.)
  ignoreDeclaration: true,
});

/** Erro "esperado": XML da nota em formato que não sabemos ler. */
export class XmlNotaInvalidoError extends Error {
  constructor(detalhe?: string) {
    super(
      detalhe
        ? `Não foi possível interpretar o XML desta nota (${detalhe}).`
        : "Não foi possível interpretar o XML desta nota (formato inesperado)."
    );
    this.name = "XmlNotaInvalidoError";
  }
}

/**
 * `true` quando o XML é só o RESUMO da nota (schema `resNFe`), não o documento
 * completo (`procNFe`/`NFe` com `infNFe`). A SEFAZ devolve `resNFe` na consulta
 * por chave enquanto o XML completo ainda não foi liberado para distribuição
 * (comum em notas recém-emitidas). Não dá pra montar DANFE a partir disso.
 */
export function ehResumoNFe(xml: string): boolean {
  if (!xml) return false;
  return /<(?:\w+:)?resNFe[\s>]/.test(xml) && !/<(?:\w+:)?infNFe[\s>]/.test(xml);
}

/**
 * Acha o nó `infNFe` (e o protocolo) em várias estruturas possíveis de XML da
 * SEFAZ: `nfeProc > NFe > infNFe`, `nfeProc > infNFe`, `NFe > infNFe` solto,
 * `infNFe` na raiz, lote com array, etc.
 */
function localizarNFe(parsed: any): { infNFe: any; protNFe: any } {
  const raiz = arr(parsed?.nfeProc)[0] ?? parsed?.nfeProc ?? parsed ?? {};
  const candidatos = [
    raiz?.NFe?.infNFe,
    raiz?.infNFe,
    arr(raiz?.NFe)[0]?.infNFe,
    parsed?.NFe?.infNFe,
    parsed?.infNFe,
    arr(parsed?.NFe)[0]?.infNFe,
  ];
  let infNFe = candidatos.find((c) => c && typeof c === "object");
  if (Array.isArray(infNFe)) infNFe = infNFe[0];

  const protNFe =
    raiz?.protNFe?.infProt ??
    arr(raiz?.protNFe)[0]?.infProt ??
    parsed?.protNFe?.infProt ??
    undefined;

  return { infNFe, protNFe };
}

function arr<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/** EAN "válido": não vazio e diferente de "SEM GTIN". */
function eanValido(v: any): string {
  const s = String(v ?? "").trim();
  return s && s.toUpperCase() !== "SEM GTIN" ? s : "";
}

export interface ItemNFe {
  codigo: string;
  descricao: string;
  ean: string; // GTIN/EAN do item (cEAN, ou cEANTrib se cEAN vier vazio/"SEM GTIN")
  ncm: string;
  cfop: string;
  cst: string;
  unidade: string;
  quantidade: string;
  valorUnitario: string;
  valorTotal: string;
  valorDesconto: string;
  baseCalcIcms: string;
  valorIcms: string;
  valorIpi: string;
  aliqIcms: string;
  aliqIpi: string;
}

export interface DuplicataNFe {
  numero: string;
  vencimento: string;
  valor: string;
}

export interface NFeParaExibir {
  chaveAcesso: string;
  numero: string;
  serie: string;
  natOp: string;
  tipoOperacao: string; // "0 - Entrada" | "1 - Saída"
  dataEmissao: string;
  protocolo: string;
  dataAutorizacao: string;

  emitente: {
    nome: string;
    cnpj: string;
    ie: string;
    endereco: string;
    telefone: string;
  };
  destinatario: {
    nome: string;
    cnpjCpf: string;
    ie: string;
    endereco: string;
    bairro: string;
    cep: string;
    municipio: string;
    uf: string;
    telefone: string;
  };

  transportador: {
    nome: string;
    cnpj: string;
    enderco: string;
    municipio: string;
    uf: string;
    ie: string;
    modFrete: string;
    volumes: string;
    especie: string;
    marca: string;
    pesoBruto: string;
    pesoLiquido: string;
  };

  duplicatas: DuplicataNFe[];

  itens: ItemNFe[];

  totais: {
    baseCalcIcms: string;
    valorIcms: string;
    baseCalcIcmsSt: string;
    valorIcmsSt: string;
    valorImportacao: string;
    valorIpi: string;
    valorPis: string;
    valorCofins: string;
    valorProdutos: string;
    valorFrete: string;
    valorSeguro: string;
    valorDesconto: string;
    outrasDespesas: string;
    valorTotalNota: string;
  };

  informacoesComplementares: string;
}

function enderecoTexto(end: any): string {
  if (!end) return "";
  const partes = [end.xLgr, end.nro, end.xCpl].filter(Boolean);
  return partes.join(", ");
}

function n(v: any): string {
  return v === undefined || v === null || v === "" ? "0" : String(v);
}

export function parseNFeXml(xml: string): NFeParaExibir {
  let parsed: any;
  try {
    parsed = parser.parse(xml ?? "");
  } catch {
    throw new XmlNotaInvalidoError("XML inválido");
  }

  const { infNFe, protNFe } = localizarNFe(parsed);
  if (!infNFe || typeof infNFe !== "object") {
    const raiz = arr(parsed?.nfeProc)[0] ?? parsed?.nfeProc ?? parsed ?? {};
    if (parsed?.resNFe || raiz?.resNFe || ehResumoNFe(xml)) {
      throw new XmlNotaInvalidoError(
        "a SEFAZ ainda só disponibilizou o resumo desta nota, não o XML completo — tente novamente mais tarde"
      );
    }
    throw new XmlNotaInvalidoError();
  }

  try {
    return extrairCampos(infNFe, protNFe);
  } catch {
    throw new XmlNotaInvalidoError();
  }
}

function extrairCampos(infNFe: any, protNFe: any): NFeParaExibir {
  const ide = infNFe.ide ?? {};
  const emit = infNFe.emit ?? {};
  const dest = infNFe.dest ?? {};
  const transp = infNFe.transp ?? {};
  const transporta = transp.transporta ?? {};
  const vol = arr(transp.vol)[0] ?? {};
  const cobr = infNFe.cobr ?? {};
  const total = infNFe.total?.ICMSTot ?? {};
  const infAdic = infNFe.infAdic ?? {};

  const detList = arr(infNFe.det);

  const itens: ItemNFe[] = detList.map((det: any) => {
    const prod = det.prod ?? {};
    const icms = det.imposto?.ICMS ?? {};
    // O grupo ICMS vem com um filho variável (ICMS00, ICMS20, ICMS60, ICMSSN102 etc)
    const icmsGrupo: any = Object.values(icms)[0] ?? {};
    const ipiGrupo: any = det.imposto?.IPI?.IPITrib ?? {};

    return {
      codigo: n(prod.cProd),
      descricao: n(prod.xProd),
      ean: eanValido(prod.cEAN) || eanValido(prod.cEANTrib),
      ncm: n(prod.NCM),
      cfop: n(prod.CFOP),
      cst: n(icmsGrupo.CST ?? icmsGrupo.CSOSN),
      unidade: n(prod.uCom),
      quantidade: n(prod.qCom),
      valorUnitario: n(prod.vUnCom),
      valorTotal: n(prod.vProd),
      valorDesconto: n(prod.vDesc),
      baseCalcIcms: n(icmsGrupo.vBC),
      valorIcms: n(icmsGrupo.vICMS),
      valorIpi: n(ipiGrupo.vIPI),
      aliqIcms: n(icmsGrupo.pICMS),
      aliqIpi: n(ipiGrupo.pIPI),
    };
  });

  const duplicatas: DuplicataNFe[] = arr(cobr.dup).map((d: any) => ({
    numero: n(d.nDup),
    vencimento: n(d.dVenc),
    valor: n(d.vDup),
  }));

  const tpNF = String(ide.tpNF ?? "");

  return {
    chaveAcesso: (infNFe["@_Id"] ?? "").replace("NFe", ""),
    numero: n(ide.nNF),
    serie: n(ide.serie),
    natOp: n(ide.natOp),
    tipoOperacao: tpNF === "0" ? "0 - Entrada" : tpNF === "1" ? "1 - Saída" : "",
    dataEmissao: n(ide.dhEmi),
    protocolo: n(protNFe?.nProt),
    dataAutorizacao: n(protNFe?.dhRecbto),

    emitente: {
      nome: n(emit.xNome),
      cnpj: n(emit.CNPJ),
      ie: n(emit.IE),
      endereco: enderecoTexto(emit.enderEmit),
      telefone: n(emit.enderEmit?.fone),
    },
    destinatario: {
      nome: n(dest.xNome),
      cnpjCpf: n(dest.CNPJ ?? dest.CPF),
      ie: n(dest.IE),
      endereco: enderecoTexto(dest.enderDest),
      bairro: n(dest.enderDest?.xBairro),
      cep: n(dest.enderDest?.CEP),
      municipio: n(dest.enderDest?.xMun),
      uf: n(dest.enderDest?.UF),
      telefone: n(dest.enderDest?.fone),
    },

    transportador: {
      nome: n(transporta.xNome),
      cnpj: n(transporta.CNPJ),
      enderco: n(transporta.xEnder),
      municipio: n(transporta.xMun),
      uf: n(transporta.UF),
      ie: n(transporta.IE),
      modFrete: n(transp.modFrete),
      volumes: n(vol.qVol),
      especie: n(vol.esp),
      marca: n(vol.marca),
      pesoBruto: n(vol.pesoB),
      pesoLiquido: n(vol.pesoL),
    },

    duplicatas,
    itens,

    totais: {
      baseCalcIcms: n(total.vBC),
      valorIcms: n(total.vICMS),
      baseCalcIcmsSt: n(total.vBCST),
      valorIcmsSt: n(total.vST),
      valorImportacao: n(total.vII),
      valorIpi: n(total.vIPI),
      valorPis: n(total.vPIS),
      valorCofins: n(total.vCOFINS),
      valorProdutos: n(total.vProd),
      valorFrete: n(total.vFrete),
      valorSeguro: n(total.vSeg),
      valorDesconto: n(total.vDesc),
      outrasDespesas: n(total.vOutro),
      valorTotalNota: n(total.vNF),
    },

    informacoesComplementares: n(infAdic.infCpl),
  };
}
