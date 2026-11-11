/**
 * Emissor de NF-e — devolução de compra (finNFe 4).
 * Funções PURAS: lê o XML da nota original e monta o XML (sem assinatura) da
 * devolução. Calibrado com devoluções reais já autorizadas pela SEFAZ/SVRS
 * (ver scripts/testar-devolucao-nfe.ts).
 */
import { XMLParser } from "fast-xml-parser";

export const CNPJ_CONTADOR_PADRAO = "04493917000126";
const ALIQ_IBS_UF_BP = 10; // 0,10% (2026 — ajustar quando mudar a regra)
const ALIQ_CBS_BP = 90; // 0,90%

// ---------- decimais em string/centavos (sem erro de ponto flutuante) ----------

/** "87.7050000000" -> centavos arredondados meio-pra-cima (8771). */
export function paraCentavos(valor: string | number): number {
  const s = String(valor).trim();
  const [int, frac = ""] = s.split(".");
  const digits = (frac + "000").slice(0, 3); // 3 casas bastam p/ decidir arredondamento
  const base = Number(int) * 100 + Number(digits.slice(0, 2));
  return base + (Number(digits[2]) >= 5 ? 1 : 0);
}

export const fmt2 = (cent: number) => (cent / 100).toFixed(2);
const fmtQtd = (n: number) => n.toFixed(4);
const fmtUnit10 = (cent: number) => (cent / 100).toFixed(10);
/** cent × (basisPoints/10000), meio-pra-cima. */
const pct = (cent: number, bp: number) => Math.floor((cent * bp + 5000) / 10000);
const bpDe = (p: string) => Math.round(Number(p) * 100);

// ---------- leitura da nota original ----------

export interface ItemOriginal {
  nItem: number;
  cProd: string;
  ean: string;
  xProd: string;
  ncm: string;
  qCom: number;
  uCom: string;
  uTrib: string;
  qTrib: number;
  vUnCom: string;
  orig: string;
  pICMS: string; // "12.0000"
}

export interface NotaOriginal {
  chave: string;
  numero: string;
  serie: string;
  emitente: {
    cnpj: string; nome: string; ie: string; logradouro: string; numero: string;
    complemento?: string; bairro: string; codMunicipio: string; municipio: string;
    uf: string; cep: string;
  };
  destCnpj: string;
  destinatario: {
    cnpj: string; nome: string; ie: string; logradouro: string; numero: string; complemento?: string;
    bairro: string; codMunicipio: string; municipio: string; uf: string; cep: string; fone?: string;
  };
  itens: ItemOriginal[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name) => name === "det",
});

export function lerNotaOriginal(xml: string): NotaOriginal {
  const j = parser.parse(xml);
  const inf = j?.nfeProc?.NFe?.infNFe ?? j?.NFe?.infNFe;
  if (!inf) throw new Error("Arquivo não é um XML de NF-e (infNFe não encontrado).");
  if (String(inf.ide?.mod) !== "55") throw new Error("Só NF-e modelo 55 é suportada.");
  const chave = String(inf["@_Id"] ?? "").replace(/^NFe/, "");
  if (chave.length !== 44) throw new Error("Chave de acesso inválida no XML.");
  const e = inf.emit;
  const a = e.enderEmit;
  const itens: ItemOriginal[] = (inf.det as any[]).map((d) => {
    const icms = Object.values(d.imposto?.ICMS ?? {})[0] as any;
    return {
      nItem: Number(d["@_nItem"]),
      cProd: String(d.prod.cProd),
      ean: String(d.prod.cEAN ?? "SEM GTIN"),
      xProd: String(d.prod.xProd),
      ncm: String(d.prod.NCM),
      qCom: Number(d.prod.qCom),
      uCom: String(d.prod.uCom ?? "UN"),
      uTrib: String(d.prod.uTrib ?? d.prod.uCom ?? "UN"),
      qTrib: Number(d.prod.qTrib ?? d.prod.qCom),
      vUnCom: String(d.prod.vUnCom),
      orig: String(icms?.orig ?? "0"),
      pICMS: String(icms?.pICMS ?? "0"),
    };
  });
  return {
    chave,
    numero: String(inf.ide.nNF),
    serie: String(inf.ide.serie),
    emitente: {
      cnpj: String(e.CNPJ), nome: String(e.xNome), ie: String(e.IE ?? ""),
      logradouro: String(a.xLgr), numero: String(a.nro), complemento: a.xCpl ? String(a.xCpl) : undefined,
      bairro: String(a.xBairro), codMunicipio: String(a.cMun), municipio: String(a.xMun),
      uf: String(a.UF), cep: String(a.CEP),
    },
    destCnpj: String(inf.dest?.CNPJ ?? ""),
    destinatario: {
      cnpj: String(inf.dest?.CNPJ ?? ""), nome: String(inf.dest?.xNome ?? ""), ie: String(inf.dest?.IE ?? ""),
      logradouro: String(inf.dest?.enderDest?.xLgr ?? ""), numero: String(inf.dest?.enderDest?.nro ?? ""),
      complemento: inf.dest?.enderDest?.xCpl ? String(inf.dest.enderDest.xCpl) : undefined,
      bairro: String(inf.dest?.enderDest?.xBairro ?? ""), codMunicipio: String(inf.dest?.enderDest?.cMun ?? ""),
      municipio: String(inf.dest?.enderDest?.xMun ?? ""), uf: String(inf.dest?.enderDest?.UF ?? ""),
      cep: String(inf.dest?.enderDest?.CEP ?? ""), fone: inf.dest?.enderDest?.fone ? String(inf.dest.enderDest.fone) : undefined,
    },
    itens,
  };
}

// ---------- montagem do XML da devolução ----------

export interface LojaEmitente {
  cnpj: string; razaoSocial: string; ie: string | null; im: string | null; cnae: string | null;
  crt: number; logradouro: string | null; numero: string | null; complemento: string | null;
  bairro: string | null; codMunicipio: string | null; municipio: string | null;
  uf: string | null; cep: string | null; fone: string | null;
}

export interface ParamsDevolucao {
  loja: LojaEmitente;
  original: NotaOriginal;
  selecao: { nItem: number; qtd: number }[];
  serie: number;
  numero: number;
  infCpl: string;
  contadorCnpj?: string | null;
  ambiente?: 1 | 2;
  dataEmissao?: Date;
  cNF?: string; // 8 dígitos (padrão: aleatório)
}

export interface ResultadoDevolucao {
  xml: string;
  chave: string;
  vNF: string;
  totalItens: number;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tag = (n: string, v: string | number | undefined | null) =>
  v === undefined || v === null || v === "" ? "" : `<${n}>${esc(String(v))}</${n}>`;

export function digitoVerificador(chave43: string): number {
  let peso = 2, soma = 0;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

function dataBrasil(d: Date): { iso: string; aamm: string; ano: number } {
  const p = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(d); // "2026-11-11 15:20:00"
  const [dia, hora] = p.split(" ");
  return { iso: `${dia}T${hora}-03:00`, aamm: dia.slice(2, 4) + dia.slice(5, 7), ano: Number(dia.slice(0, 4)) };
}

export function textoInfCpl(loja: Pick<LojaEmitente, "crt">, numeroNfOriginal: string, caso: string): string {
  const base = `DEVOLUCAO REFERENTE A FALTA DE MERCADORIA NA NF ${numeroNfOriginal.padStart(9, "0")}.CASE: ${caso}`;
  return loja.crt === 1
    ? `NF EMITIDA POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL,NÃO GERA DIREITO A CRÉDITO FISCAL DE IPI. ${base}`
    : base;
}

export function montarDevolucao(p: ParamsDevolucao): ResultadoDevolucao {
  const { loja, original: o } = p;
  const faltando = (["ie", "codMunicipio", "uf", "logradouro", "numero", "bairro", "cep"] as const).filter((k) => !loja[k]);
  if (faltando.length) throw new Error(`Cadastro da loja incompleto: ${faltando.join(", ")}.`);
  if (!p.selecao.length) throw new Error("Selecione ao menos um item.");

  const ambiente = p.ambiente ?? 1;
  const dt = dataBrasil(p.dataEmissao ?? new Date());
  const cUF = loja.codMunicipio!.slice(0, 2);
  const cNF = p.cNF ?? String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const chave43 =
    cUF + dt.aamm + loja.cnpj + "55" + String(p.serie).padStart(3, "0") +
    String(p.numero).padStart(9, "0") + "1" + cNF;
  const dv = digitoVerificador(chave43);
  const chave = chave43 + dv;

  const mesmaUf = loja.uf === o.emitente.uf;
  const cfop = mesmaUf ? "5202" : "6202";
  const ibsCbs = loja.crt !== 1 && dt.ano >= 2026;

  let somaProd = 0, somaBC = 0, somaICMS = 0, somaIBSUF = 0, somaCBS = 0, somaBCIbs = 0;
  let dets = "";
  let n = 0;
  for (const s of p.selecao) {
    const it = o.itens.find((x) => x.nItem === s.nItem);
    if (!it) throw new Error(`Item ${s.nItem} não existe na nota original.`);
    if (!(s.qtd > 0) || s.qtd > it.qCom) throw new Error(`Quantidade inválida no item ${it.cProd} (máx. ${it.qCom}).`);
    n++;
    const unit = paraCentavos(it.vUnCom);
    const vProd = Math.round(s.qtd * unit);
    const bp = bpDe(it.pICMS);
    const vICMS = pct(vProd, bp);
    somaProd += vProd; somaBC += vProd; somaICMS += vICMS;

    const icms =
      loja.crt === 1
        ? `<ICMSSN900>${tag("orig", it.orig)}<CSOSN>900</CSOSN><modBC>0</modBC><vBC>${fmt2(vProd)}</vBC><pICMS>${(bp / 100).toFixed(2)}</pICMS><vICMS>${fmt2(vICMS)}</vICMS><modBCST>4</modBCST><pMVAST>0.00</pMVAST><pRedBCST>0.00</pRedBCST><vBCST>0.00</vBCST><pICMSST>18.00</pICMSST><vICMSST>0.00</vICMSST><pCredSN>${(bp / 100).toFixed(2)}</pCredSN><vCredICMSSN>0.00</vCredICMSSN></ICMSSN900>`
        : `<ICMS90>${tag("orig", it.orig)}<CST>90</CST><modBC>3</modBC><vBC>${fmt2(vProd)}</vBC><pRedBC>0.00</pRedBC><pICMS>${(bp / 100).toFixed(2)}</pICMS><vICMS>${fmt2(vICMS)}</vICMS><modBCST>4</modBCST><pMVAST>0.00</pMVAST><pRedBCST>0.00</pRedBCST><vBCST>0.00</vBCST><pICMSST>18.00</pICMSST><vICMSST>0.00</vICMSST></ICMS90>`;

    let ibsXml = "", vItemXml = "";
    if (ibsCbs) {
      const base = vProd - vICMS;
      const ibs = pct(base, ALIQ_IBS_UF_BP);
      const cbs = pct(base, ALIQ_CBS_BP);
      somaIBSUF += ibs; somaCBS += cbs; somaBCIbs += base;
      ibsXml = `<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>${fmt2(base)}</vBC><gIBSUF><pIBSUF>${(ALIQ_IBS_UF_BP / 100).toFixed(2)}</pIBSUF><vIBSUF>${fmt2(ibs)}</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.00</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>${fmt2(ibs)}</vIBS><gCBS><pCBS>${(ALIQ_CBS_BP / 100).toFixed(2)}</pCBS><vCBS>${fmt2(cbs)}</vCBS></gCBS></gIBSCBS></IBSCBS>`;
      vItemXml = `<vItem>${fmt2(vProd + ibs + cbs)}</vItem>`;
    }

    dets +=
      `<det nItem="${n}"><prod>${tag("cProd", it.cProd)}${tag("cEAN", it.ean)}${tag("xProd", it.xProd)}${tag("NCM", it.ncm)}` +
      `<CFOP>${cfop}</CFOP><uCom>${esc(it.uCom)}</uCom><qCom>${fmtQtd(s.qtd)}</qCom><vUnCom>${fmtUnit10(unit)}</vUnCom><vProd>${fmt2(vProd)}</vProd>` +
      `${tag("cEANTrib", it.ean)}<uTrib>${esc(it.uTrib)}</uTrib><qTrib>${fmtQtd((s.qtd * it.qTrib) / it.qCom)}</qTrib><vUnTrib>${fmtUnit10(unit)}</vUnTrib><indTot>1</indTot></prod>` +
      `<imposto><ICMS>${icms}</ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>${ibsXml}</imposto>${vItemXml}</det>`;
  }

  const e = o.emitente;
  const ide =
    `<ide><cUF>${cUF}</cUF><cNF>${cNF}</cNF><natOp>DEVOLUCAO DE COMPRA</natOp><mod>55</mod><serie>${p.serie}</serie><nNF>${p.numero}</nNF>` +
    `<dhEmi>${dt.iso}</dhEmi><dhSaiEnt>${dt.iso}</dhSaiEnt><tpNF>1</tpNF><idDest>${mesmaUf ? 1 : 2}</idDest><cMunFG>${loja.codMunicipio}</cMunFG>` +
    `<tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${dv}</cDV><tpAmb>${ambiente}</tpAmb><finNFe>4</finNFe><indFinal>0</indFinal><indPres>0</indPres><procEmi>0</procEmi>` +
    `<verProc>SEFAZ-APP 1.0</verProc><NFref><refNFe>${o.chave}</refNFe></NFref></ide>`;
  const emit =
    `<emit>${tag("CNPJ", loja.cnpj)}${tag("xNome", loja.razaoSocial)}<enderEmit>${tag("xLgr", loja.logradouro)}${tag("nro", loja.numero)}${tag("xCpl", loja.complemento)}` +
    `${tag("xBairro", loja.bairro)}${tag("cMun", loja.codMunicipio)}${tag("xMun", loja.municipio)}${tag("UF", loja.uf)}${tag("CEP", loja.cep)}<cPais>1058</cPais><xPais>Brasil</xPais>${tag("fone", loja.fone)}</enderEmit>` +
    `${tag("IE", loja.ie)}${tag("IM", loja.im ?? "ISENTO")}${tag("CNAE", loja.cnae)}<CRT>${loja.crt}</CRT></emit>`;
  const dest =
    `<dest>${tag("CNPJ", e.cnpj)}${tag("xNome", e.nome.toUpperCase())}<enderDest>${tag("xLgr", e.logradouro)}${tag("nro", e.numero)}${tag("xCpl", e.complemento)}` +
    `${tag("xBairro", e.bairro)}${tag("cMun", e.codMunicipio)}${tag("xMun", e.municipio.toUpperCase())}${tag("UF", e.uf)}${tag("CEP", e.cep)}<cPais>1058</cPais><xPais>BRASIL</xPais></enderDest>` +
    `<indIEDest>1</indIEDest>${tag("IE", e.ie)}</dest>`;
  const aut = p.contadorCnpj ? `<autXML><CNPJ>${p.contadorCnpj}</CNPJ></autXML>` : "";

  const totalIbs = ibsCbs
    ? `<IBSCBSTot><vBCIBSCBS>${fmt2(somaBCIbs)}</vBCIBSCBS><gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>${fmt2(somaIBSUF)}</vIBSUF></gIBSUF><gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>${fmt2(somaIBSUF)}</vIBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gIBS><gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vCBS>${fmt2(somaCBS)}</vCBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS></IBSCBSTot><vNFTot>${fmt2(somaProd + somaIBSUF + somaCBS)}</vNFTot>`
    : "";
  const total =
    `<total><ICMSTot><vBC>${fmt2(somaBC)}</vBC><vICMS>${fmt2(somaICMS)}</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
    `<vProd>${fmt2(somaProd)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${fmt2(somaProd)}</vNF><vTotTrib>0.00</vTotTrib></ICMSTot>${totalIbs}</total>`;
  const resto =
    `<transp><modFrete>9</modFrete><vol><qVol>0</qVol><pesoL>0.000</pesoL><pesoB>0.000</pesoB></vol></transp>` +
    `<pag><detPag><tPag>90</tPag><vPag>0.00</vPag></detPag></pag>` +
    (p.infCpl ? `<infAdic><infCpl>${esc(p.infCpl)}</infCpl></infAdic>` : "");

  const xml =
    `<?xml version="1.0" encoding="utf-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="NFe${chave}">` +
    ide + emit + dest + aut + dets + total + resto + `</infNFe></NFe>`;
  return { xml, chave, vNF: fmt2(somaProd), totalItens: n };
}
