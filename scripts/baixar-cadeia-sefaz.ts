/**
 * Baixa a cadeia de certificados (intermediárias + raiz) dos servidores da SVRS e grava em
 * src/certs/sefaz-cadeia.pem — resolve "unable to get local issuer certificate".
 * São certificados PÚBLICOS (sem chave privada), seguros de versionar.
 *
 *   npx tsx scripts/baixar-cadeia-sefaz.ts
 */
import fs from "fs";
import http from "http";
import https from "https";
import path from "path";
import tls from "tls";

const HOSTS = ["nfe-homologacao.svrs.rs.gov.br", "nfe.svrs.rs.gov.br"];
const SAIDA = path.join(__dirname, "..", "src", "certs", "sefaz-cadeia.pem");

const pem = (der: Buffer) =>
  `-----BEGIN CERTIFICATE-----\n${der.toString("base64").replace(/(.{64})/g, "$1\n")}\n-----END CERTIFICATE-----\n`;

function baixar(url: string): Promise<Buffer> {
  const cli = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    cli.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return resolve(baixar(res.headers.location));
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

function cadeiaDoServidor(host: string): Promise<tls.DetailedPeerCertificate> {
  return new Promise((resolve, reject) => {
    // rejectUnauthorized:false SÓ para ler a cadeia que o servidor apresenta; nada é enviado.
    const s = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const c = s.getPeerCertificate(true);
      s.end();
      resolve(c);
    });
    s.on("error", reject);
  });
}

async function main() {
  const certs = new Map<string, Buffer>(); // fingerprint -> DER
  for (const host of HOSTS) {
    console.log(`\n== ${host}`);
    let c: any = await cadeiaDoServidor(host);
    const vistos = new Set<string>();
    let primeiro = true;
    while (c && !vistos.has(c.fingerprint256)) {
      vistos.add(c.fingerprint256);
      console.log(`${primeiro ? "servidor    " : "autoridade  "} ${c.subject?.CN}  <- emitido por: ${c.issuer?.CN}  (válido até ${c.valid_to})`);
      if (!primeiro) certs.set(c.fingerprint256, c.raw);
      primeiro = false;
      const autoassinado = c.subject?.CN === c.issuer?.CN;
      if (autoassinado) break;
      if (c.issuerCertificate && c.issuerCertificate !== c) { c = c.issuerCertificate; continue; }
      // a cadeia veio incompleta: tenta a URL "CA Issuers" (AIA) do certificado
      const url = /CA Issuers - URI:(\S+)/.exec(c.infoAccess ? [].concat(c.infoAccess as any).join("\n") : "")?.[1];
      if (!url) { console.log("  (cadeia incompleta e sem URL AIA)"); break; }
      console.log("  baixando emissor em", url);
      const der = await baixar(url);
      const x = new (require("crypto").X509Certificate)(der.length && der[0] === 0x30 ? der : Buffer.from(der.toString(), "utf8"));
      c = { fingerprint256: x.fingerprint256, subject: parse(x.subject), issuer: parse(x.issuer), valid_to: x.validTo, raw: x.raw, infoAccess: x.infoAccess };
    }
  }
  if (!certs.size) throw new Error("Nenhuma autoridade certificadora encontrada.");
  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, Array.from(certs.values()).map(pem).join(""));
  console.log(`\nGravado: ${SAIDA} (${certs.size} certificado(s) de autoridade)`);
}

function parse(dn: string) {
  return { CN: /CN=([^\n]+)/.exec(dn)?.[1] ?? dn };
}

main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
