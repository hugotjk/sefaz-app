import crypto from "crypto";

/**
 * Criptografia dos certificados digitais (.pfx) e senhas.
 *
 * A chave mestra vem de uma env var (ENCRYPTION_KEY) que NUNCA deve ser
 * commitada. Gere uma com: `openssl rand -hex 32`
 *
 * Guardamos { pfxBase64, password } como um único JSON criptografado.
 */

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY não configurada. Gere uma com `openssl rand -hex 32` e adicione nas env vars."
    );
  }
  const buf = Buffer.from(key, "hex");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY inválida: precisa ter 32 bytes (64 caracteres hex).");
  }
  return buf;
}

export interface CertificatePayload {
  pfxBase64: string;
  password: string;
}

export interface EncryptedResult {
  encryptedBlob: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

export function encryptCertificate(payload: CertificatePayload): EncryptedResult {
  const key = getKey();
  const iv = crypto.randomBytes(12); // GCM recomenda 12 bytes
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedBlob: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptCertificate(record: {
  encryptedBlob: string;
  iv: string;
  authTag: string;
}): CertificatePayload {
  const key = getKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(record.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(record.authTag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(record.encryptedBlob, "base64")),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}
