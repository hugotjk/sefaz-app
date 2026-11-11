import forge from "node-forge";
import { SignedXml } from "xml-crypto";

/** Extrai chave privada (PEM) e certificado (PEM e DER base64) de um .pfx. */
export function lerPfx(pfxBase64: string, senha: string) {
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(pfxBase64)), senha);
  const keyBag =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  if (!keyBag?.key) throw new Error("Chave privada não encontrada no certificado.");
  // o certificado do titular é o que casa com a chave privada
  const pubKey = (keyBag.key as forge.pki.rsa.PrivateKey).n.toString(16);
  const certBag =
    certBags.find((b) => (b.cert?.publicKey as forge.pki.rsa.PublicKey | undefined)?.n.toString(16) === pubKey) ??
    certBags[0];
  if (!certBag?.cert) throw new Error("Certificado não encontrado no .pfx.");
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certBag.cert)).getBytes();
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keyBag.key as forge.pki.PrivateKey),
    certPem: forge.pki.certificateToPem(certBag.cert),
    certBase64: forge.util.encode64(certDer),
  };
}

/**
 * Assina o <infNFe> (RSA-SHA1, c14n, enveloped) e devolve o XML da <NFe> com a
 * <Signature> inserida logo após o infNFe — layout exigido pela SEFAZ.
 */
export function assinarNFe(nfeXml: string, pfxBase64: string, senha: string): string {
  const { privateKeyPem, certBase64 } = lerPfx(pfxBase64, senha);
  const id = /<infNFe[^>]*\sId="(NFe\d{44})"/.exec(nfeXml)?.[1];
  if (!id) throw new Error("infNFe/Id não encontrado no XML.");

  const sig = new SignedXml({
    privateKey: privateKeyPem,
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    getKeyInfoContent: () => `<X509Data><X509Certificate>${certBase64}</X509Certificate></X509Data>`,
  });
  sig.addReference({
    xpath: `//*[@Id='${id}']`,
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
  });
  sig.computeSignature(nfeXml, { location: { reference: `//*[local-name()='infNFe']`, action: "after" } });
  return sig.getSignedXml();
}
