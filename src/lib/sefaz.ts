import https from "https";
import zlib from "zlib";
import forge from "node-forge";
import { XMLParser } from "fast-xml-parser";

/**
 * Integração com o webservice nacional NFeDistribuicaoDFe.
 *
 * Esse serviço retorna TODOS os documentos fiscais destinados a um CNPJ
 * (notas recebidas, cartas de correção, cancelamentos, etc.), paginados por
 * NSU (Número Sequencial Único). É exatamente o que cobre o caso de uso:
 * não precisa consultar UF por UF.
 *
 * Doc oficial: Manual de Integração NFeDistribuicaoDFe (Portal Nacional NF-e).
 * ATENÇÃO: os endpoints/campos abaixo seguem a versão pública mais recente
 * conhecida, mas a SEFAZ ocasionalmente ajusta o schema — vale validar contra
 * o manual oficial ao testar com um certificado real.
 */

const ENDPOINT_PRODUCAO =
  "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
const ENDPOINT_HOMOLOGACAO =
  "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";

// Código do "autor" do pedido = UF de vinculação do certificado do interessado.
// 91 = Ambiente Nacional (usado por padrão para distribuição). Ajustável se necessário.
const CUF_AUTOR = "91";

// SOAPAction embutida no Content-Type — exigida por webservices ASMX/WCF
// como este da SEFAZ. Sem isso, o servidor rejeita a requisição com HTTP 403
// antes mesmo de tentar processar o XML.
const SOAP_ACTION =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";
const SOAP_CONTENT_TYPE = `application/soap+xml; charset=utf-8; action="${SOAP_ACTION}"`;

export class SenhaInvalidaError extends Error {
  constructor() {
    super("Senha do certificado digital incorreta.");
    this.name = "SenhaInvalidaError";
  }
}

/** Valida se a senha abre o .pfx (sem precisar bater na rede). */
export function validarSenhaCertificado(pfxBase64: string, senha: string): boolean {
  try {
    const pfxDer = forge.util.decode64(pfxBase64);
    const asn1 = forge.asn1.fromDer(pfxDer);
    forge.pkcs12.pkcs12FromAsn1(asn1, senha);
    return true;
  } catch {
    return false;
  }
}

function buildHttpsAgent(pfxBuffer: Buffer, senha: string): https.Agent {
  return new https.Agent({
    pfx: pfxBuffer,
    passphrase: senha,
    // A SEFAZ valida o certificado do cliente (mTLS); mantemos a verificação
    // padrão do servidor ligada.
    rejectUnauthorized: true,
  });
}

function soapEnvelope(cnpj: string, ultNSU: string, tpAmb: "1" | "2" = "1") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${CUF_AUTOR}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <distNSU>
            <ultNSU>${ultNSU.padStart(15, "0")}</ultNSU>
          </distNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
}

export interface DocumentoDistribuicao {
  schema: string; // ex: "resNFe_v1.01.xsd", "procNFe_v4.00.xsd", "resEve_v1.01.xsd"
  nsu: string;
  xml: string; // XML já descompactado
}

export interface ResultadoDistribuicao {
  ultNSU: string;
  maxNSU: string;
  statusCode: string;
  documentos: DocumentoDistribuicao[];
  semDocumentosNovos: boolean;
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

/**
 * Consulta um "lote" de documentos a partir do ultNSU salvo.
 * A SEFAZ retorna no máximo 50 documentos por chamada — por isso o backfill
 * inicial precisa chamar isso em loop (feito na função do Inngest, que aguenta
 * chamadas longas/paginadas sem timeout).
 */
export async function consultarDistribuicaoDFe(params: {
  cnpj: string;
  ultNSU: string;
  pfxBuffer: Buffer;
  senha: string;
  ambiente?: "producao" | "homologacao";
}): Promise<ResultadoDistribuicao> {
  const { cnpj, ultNSU, pfxBuffer, senha, ambiente = "producao" } = params;

  const agent = buildHttpsAgent(pfxBuffer, senha);
  const url = ambiente === "producao" ? ENDPOINT_PRODUCAO : ENDPOINT_HOMOLOGACAO;
  const body = soapEnvelope(cnpj, ultNSU, ambiente === "producao" ? "1" : "2");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": SOAP_CONTENT_TYPE },
    body,
    // @ts-expect-error - agent é suportado no runtime Node da Vercel (não em Edge)
    agent,
  });

  if (!response.ok) {
    throw new Error(`SEFAZ retornou HTTP ${response.status}`);
  }

  const rawXml = await response.text();
  const parsed = xmlParser.parse(rawXml);

  const body_ =
    parsed?.["soap:Envelope"]?.["soap:Body"] ??
    parsed?.["soap12:Envelope"]?.["soap12:Body"];
  const retDistDFeInt =
    body_?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult?.retDistDFeInt;

  if (!retDistDFeInt) {
    throw new Error("Resposta da SEFAZ em formato inesperado. Verifique o XML bruto retornado.");
  }

  const cStat = String(retDistDFeInt.cStat ?? "");
  // 137 = "Nenhum documento localizado" (não é erro, só não há novidade)
  const semDocumentosNovos = cStat === "137";

  const loteRaw = retDistDFeInt.loteDistDFeInt?.docZip;
  const lista = loteRaw ? (Array.isArray(loteRaw) ? loteRaw : [loteRaw]) : [];

  const documentos: DocumentoDistribuicao[] = lista.map((doc: any) => {
    const nsu = doc["@_NSU"];
    const schema = doc["@_schema"];
    const base64Content = typeof doc === "string" ? doc : doc["#text"];
    const xml = zlib.gunzipSync(Buffer.from(base64Content, "base64")).toString("utf8");
    return { schema, nsu, xml };
  });

  return {
    ultNSU: String(retDistDFeInt.ultNSU ?? ultNSU),
    maxNSU: String(retDistDFeInt.maxNSU ?? ultNSU),
    statusCode: cStat,
    documentos,
    semDocumentosNovos,
  };
}

/**
 * IMPORTANTE: a consulta por distNSU (acima) retorna apenas um RESUMO (resNFe)
 * de cada nota — não o XML completo/autorizado. Para exibir a nota "impressa"
 * (estilo DANFE) precisamos do XML completo (procNFe), que se obtém com uma
 * segunda chamada ao mesmo webservice, trocando <distNSU> por <consChNFe>
 * com a chave de acesso da nota. É isso que fazemos aqui.
 */
export async function consultarPorChave(params: {
  chaveAcesso: string;
  cnpj: string;
  pfxBuffer: Buffer;
  senha: string;
  ambiente?: "producao" | "homologacao";
}): Promise<{ xmlCompleto: string } | null> {
  const { chaveAcesso, cnpj, pfxBuffer, senha, ambiente = "producao" } = params;

  const agent = buildHttpsAgent(pfxBuffer, senha);
  const url = ambiente === "producao" ? ENDPOINT_PRODUCAO : ENDPOINT_HOMOLOGACAO;
  const tpAmb = ambiente === "producao" ? "1" : "2";

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${CUF_AUTOR}</cUFAutor>
          <CNPJ>${cnpj}</CNPJ>
          <consChNFe>
            <chNFe>${chaveAcesso}</chNFe>
          </consChNFe>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": SOAP_CONTENT_TYPE },
    body,
    // @ts-expect-error - agent é suportado no runtime Node da Vercel
    agent,
  });

  if (!response.ok) throw new Error(`SEFAZ retornou HTTP ${response.status}`);

  const rawXml = await response.text();
  const parsed = xmlParser.parse(rawXml);
  const body_ =
    parsed?.["soap:Envelope"]?.["soap:Body"] ?? parsed?.["soap12:Envelope"]?.["soap12:Body"];
  const retDistDFeInt =
    body_?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult?.retDistDFeInt;

  const doc = retDistDFeInt?.loteDistDFeInt?.docZip;
  if (!doc) return null;

  const base64Content = typeof doc === "string" ? doc : doc["#text"];
  const xmlCompleto = zlib.gunzipSync(Buffer.from(base64Content, "base64")).toString("utf8");
  return { xmlCompleto };
}
