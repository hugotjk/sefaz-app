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
 *
 * IMPORTANTE (lição aprendida): o `fetch()` nativo do Node NÃO respeita a
 * opção `agent` (isso é específico de libs antigas como node-fetch/axios).
 * Pra mandar o certificado cliente (mTLS) de forma confiável, usamos
 * `https.request` diretamente em vez de `fetch`.
 */

const ENDPOINT_PRODUCAO = "www1.nfe.fazenda.gov.br";
const ENDPOINT_PATH = "/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
const ENDPOINT_HOMOLOGACAO_HOST = "hom1.nfe.fazenda.gov.br";

// Código do "autor" do pedido = UF de vinculação do certificado do interessado.
// 91 = Ambiente Nacional (usado por padrão para distribuição). Ajustável se necessário.
const CUF_AUTOR = "91";

// SOAPAction embutida no Content-Type — exigida por webservices ASMX/WCF
// como este da SEFAZ. Sem isso, o servidor pode rejeitar a requisição antes
// mesmo de tentar processar o XML.
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

interface SoapHttpResult {
  statusCode: number;
  body: string;
}

/**
 * Faz um POST HTTPS com certificado cliente (mTLS), sem depender do fetch.
 * Isso garante que o .pfx realmente é enviado na negociação TLS.
 */
function soapPost(params: {
  host: string;
  path: string;
  body: string;
  pfxBuffer: Buffer;
  senha: string;
}): Promise<SoapHttpResult> {
  const { host, path, body, pfxBuffer, senha } = params;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        path,
        method: "POST",
        pfx: pfxBuffer,
        passphrase: senha,
        rejectUnauthorized: true,
        headers: {
          "Content-Type": SOAP_CONTENT_TYPE,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error("Tempo esgotado ao conectar na SEFAZ.")));
    req.on("error", (err) => {
      // Erros de TLS relacionados à senha errada do certificado costumam
      // vir com essas palavras-chave no message do OpenSSL.
      const msg = err.message.toLowerCase();
      if (msg.includes("mac verify failure") || msg.includes("bad decrypt")) {
        reject(new SenhaInvalidaError());
      } else {
        reject(err);
      }
    });

    req.write(body);
    req.end();
  });
}

function soapEnvelopeDistNSU(cnpj: string, ultNSU: string, tpAmb: "1" | "2" = "1") {
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

function soapEnvelopeConsChave(cnpj: string, chaveAcesso: string, tpAmb: "1" | "2" = "1") {
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
          <consChNFe>
            <chNFe>${chaveAcesso}</chNFe>
          </consChNFe>
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
  motivo: string;
  documentos: DocumentoDistribuicao[];
  semDocumentosNovos: boolean;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false, // mantém NSUs como string (senão perde os zeros à esquerda)
});

function extrairRetDistDFeInt(rawXml: string): any {
  const parsed = xmlParser.parse(rawXml);
  const body_ =
    parsed?.["soap:Envelope"]?.["soap:Body"] ?? parsed?.["soap12:Envelope"]?.["soap12:Body"];
  return body_?.nfeDistDFeInteresseResponse?.nfeDistDFeInteresseResult?.retDistDFeInt;
}

function checarStatusHttp(resultado: SoapHttpResult) {
  if (resultado.statusCode < 200 || resultado.statusCode >= 300) {
    // Incluímos um trecho do corpo da resposta (sem dados sensíveis, é
    // resposta pública da SEFAZ) pra ajudar a diagnosticar o motivo real.
    const trecho = resultado.body.slice(0, 500).replace(/\s+/g, " ").trim();
    throw new Error(
      `SEFAZ retornou HTTP ${resultado.statusCode}. Início da resposta: ${trecho || "(vazio)"}`
    );
  }
}

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

  const host = ambiente === "producao" ? ENDPOINT_PRODUCAO : ENDPOINT_HOMOLOGACAO_HOST;
  const body = soapEnvelopeDistNSU(cnpj, ultNSU, ambiente === "producao" ? "1" : "2");

  const resultado = await soapPost({ host, path: ENDPOINT_PATH, body, pfxBuffer, senha });
  checarStatusHttp(resultado);

  const retDistDFeInt = extrairRetDistDFeInt(resultado.body);
  if (!retDistDFeInt) {
    const trecho = resultado.body.slice(0, 800);
    throw new Error(`Resposta da SEFAZ em formato inesperado. Corpo bruto: ${trecho}`);
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
    motivo: String(retDistDFeInt.xMotivo ?? ""),
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

  const host = ambiente === "producao" ? ENDPOINT_PRODUCAO : ENDPOINT_HOMOLOGACAO_HOST;
  const body = soapEnvelopeConsChave(cnpj, chaveAcesso, ambiente === "producao" ? "1" : "2");

  const resultado = await soapPost({ host, path: ENDPOINT_PATH, body, pfxBuffer, senha });
  checarStatusHttp(resultado);

  const retDistDFeInt = extrairRetDistDFeInt(resultado.body);
  const doc = retDistDFeInt?.loteDistDFeInt?.docZip;
  if (!doc) return null;

  const base64Content = typeof doc === "string" ? doc : doc["#text"];
  const xmlCompleto = zlib.gunzipSync(Buffer.from(base64Content, "base64")).toString("utf8");
  return { xmlCompleto };
}
