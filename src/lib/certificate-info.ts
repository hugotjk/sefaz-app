import forge from "node-forge";

export interface InfoCertificado {
  cnpj: string;
  razaoSocial: string;
  validUntil: Date;
}

/**
 * Extrai CNPJ, razão social e validade de um certificado A1 (.pfx) ICP-Brasil.
 * Certificados e-CNPJ trazem o CN no formato "RAZAO SOCIAL:CNPJ".
 */
export function extrairInfoCertificado(pfxBase64: string, senha: string): InfoCertificado {
  const pfxDer = forge.util.decode64(pfxBase64);
  const asn1 = forge.asn1.fromDer(pfxDer);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, senha);

  const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = bags[forge.pki.oids.certBag]?.[0];
  if (!certBag?.cert) {
    throw new Error("Não foi possível ler o certificado dentro do .pfx.");
  }

  const cert = certBag.cert;
  const cn = cert.subject.getField("CN")?.value ?? "";

  // Formato comum ICP-Brasil e-CNPJ: "EMPRESA LTDA:12345678000199"
  const match = cn.match(/:(\d{14})/);
  const cnpj = match ? match[1] : "";
  const razaoSocial = match ? cn.slice(0, match.index).trim() : cn;

  return {
    cnpj,
    razaoSocial,
    validUntil: cert.validity.notAfter,
  };
}
