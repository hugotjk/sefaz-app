/**
 * Comunicação com os webservices NF-e 4.00 da SVRS (autoriza RJ).
 * Hosts/paths podem ser trocados por env (SEFAZ_NFE_HOST_PROD / SEFAZ_NFE_HOST_HOM) se a SEFAZ mudar.
 */
import https from "https";
import { XMLParser } from "fast-xml-parser";

const HOST: Record<1 | 2, string> = {
  1: process.env.SEFAZ_NFE_HOST_PROD || "nfe.svrs.rs.gov.br",
  2: process.env.SEFAZ_NFE_HOST_HOM || "nfe-homologacao.svrs.rs.gov.br",
};

const SERVICOS = {
  status: {
    path: "/ws/NfeStatusServico/NfeStatusServico4.asmx",
    ns: "http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4",
    action: "nfeStatusServicoNF",
  },
  autorizacao: {
    path: "/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
    ns: "http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4",
    action: "nfeAutorizacaoLote",
  },
  consulta: {
    path: "/ws/NfeConsulta/NfeConsulta4.asmx",
    ns: "http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4",
    action: "nfeConsultaNF",
  },
} as const;

export type Ambiente = 1 | 2;

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false });

function achar(obj: any, chave: string): any {
  if (!obj || typeof obj !== "object") return undefined;
  if (chave in obj) return obj[chave];
  for (const k of Object.keys(obj)) {
    const r = achar(obj[k], chave);
    if (r !== undefined) return r;
  }
  return undefined;
}

function post(servico: keyof typeof SERVICOS, ambiente: Ambiente, corpo: string, pfxBase64: string, senha: string) {
  const s = SERVICOS[servico];
  const envelope =
    `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>` +
    `<nfeDadosMsg xmlns="${s.ns}">${corpo}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
  return new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        host: HOST[ambiente], path: s.path, method: "POST",
        pfx: Buffer.from(pfxBase64, "base64"), passphrase: senha, rejectUnauthorized: true,
        headers: {
          "Content-Type": `application/soap+xml; charset=utf-8; action="${s.ns}/${s.action}"`,
          "Content-Length": Buffer.byteLength(envelope),
        },
        timeout: 60_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 0) >= 400) reject(new Error(`SEFAZ respondeu HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
          else resolve(body);
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Tempo esgotado ao falar com a SEFAZ.")));
    req.on("error", reject);
    req.write(envelope);
    req.end();
  });
}

export interface RetornoStatus { cStat: string; xMotivo: string }

export async function statusServico(ambiente: Ambiente, cUF: string, pfx: string, senha: string): Promise<RetornoStatus> {
  const corpo = `<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>${ambiente}</tpAmb><cUF>${cUF}</cUF><xServ>STATUS</xServ></consStatServ>`;
  const j = parser.parse(await post("status", ambiente, corpo, pfx, senha));
  const r = achar(j, "retConsStatServ");
  if (!r) throw new Error("Resposta inesperada da SEFAZ (status).");
  return { cStat: String(r.cStat), xMotivo: String(r.xMotivo) };
}

export interface RetornoAutorizacao {
  cStat: string; // do protocolo (100 = autorizada) ou do lote
  xMotivo: string;
  nProt?: string;
  dhRecbto?: string;
  protNFeXml?: string; // XML cru do <protNFe>
}

/** Extrai o <protNFe> cru da resposta (sem xmlns repetido), para montar o nfeProc. */
function extrairProtNFe(resp: string): string | undefined {
  const m = /<(?:\w+:)?protNFe[\s\S]*?<\/(?:\w+:)?protNFe>/.exec(resp);
  return m?.[0].replace(/\sxmlns(:\w+)?="http:\/\/www\.portalfiscal\.inf\.br\/nfe"/g, "");
}

export function lerProtocolo(resp: string): RetornoAutorizacao {
  const j = parser.parse(resp);
  const prot = achar(j, "infProt");
  if (prot) {
    return {
      cStat: String(prot.cStat), xMotivo: String(prot.xMotivo),
      nProt: prot.nProt ? String(prot.nProt) : undefined,
      dhRecbto: prot.dhRecbto ? String(prot.dhRecbto) : undefined,
      protNFeXml: extrairProtNFe(resp),
    };
  }
  const ret = achar(j, "retEnviNFe") ?? achar(j, "retConsSitNFe");
  if (!ret) throw new Error("Resposta inesperada da SEFAZ: " + resp.slice(0, 300));
  return { cStat: String(ret.cStat), xMotivo: String(ret.xMotivo) };
}

/** Envia uma NF-e assinada (lote de 1, síncrono). */
export async function autorizarNFe(nfeAssinada: string, ambiente: Ambiente, pfx: string, senha: string): Promise<RetornoAutorizacao> {
  const corpo = `<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><idLote>${Date.now().toString().slice(-15)}</idLote><indSinc>1</indSinc>${nfeAssinada}</enviNFe>`;
  return lerProtocolo(await post("autorizacao", ambiente, corpo, pfx, senha));
}

export async function consultarChaveNFe(chave: string, ambiente: Ambiente, pfx: string, senha: string): Promise<RetornoAutorizacao> {
  const corpo = `<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>${ambiente}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`;
  return lerProtocolo(await post("consulta", ambiente, corpo, pfx, senha));
}

/** Monta o arquivo final (nfeProc) = NFe assinada + protocolo de autorização. */
export function montarNfeProc(nfeAssinada: string, protNFeXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${nfeAssinada}${protNFeXml}</nfeProc>`;
}
