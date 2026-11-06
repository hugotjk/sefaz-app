import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

/** Backblaze B2 pela API S3 (bucket privado). Variáveis: B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET, B2_ENDPOINT. */
let _client: S3Client | null = null;

function config() {
  // aspas, espaços e quebras de linha colados junto com o valor quebram a assinatura
  const lim = (v?: string) => v?.trim().replace(/^["']|["']$/g, "").trim();
  const keyId = lim(process.env.B2_KEY_ID);
  const secret = lim(process.env.B2_APPLICATION_KEY);
  const bucket = lim(process.env.B2_BUCKET);
  let endpoint = lim(process.env.B2_ENDPOINT)?.replace(/\/+$/, "");
  if (!keyId || !secret || !bucket || !endpoint) {
    throw new Error("Armazenamento não configurado (B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET, B2_ENDPOINT).");
  }
  if (!/^https?:\/\//.test(endpoint)) endpoint = `https://${endpoint}`;
  const region = /s3\.([a-z0-9-]+)\.backblazeb2\.com/.exec(endpoint)?.[1] ?? "us-west-004";
  return { keyId, secret, bucket, endpoint, region };
}

function client() {
  if (_client) return _client;
  const c = config();
  _client = new S3Client({
    region: c.region,
    endpoint: c.endpoint,
    credentials: { accessKeyId: c.keyId, secretAccessKey: c.secret },
    forcePathStyle: true,
  });
  return _client;
}

export async function b2Put(key: string, body: Buffer, contentType: string) {
  await client().send(new PutObjectCommand({ Bucket: config().bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function b2Get(key: string): Promise<Buffer> {
  const r = await client().send(new GetObjectCommand({ Bucket: config().bucket, Key: key }));
  const bytes = await r.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function b2Delete(key: string) {
  await client().send(new DeleteObjectCommand({ Bucket: config().bucket, Key: key }));
}

export async function b2List(prefix: string): Promise<{ key: string; size: number; modificado: Date | null }[]> {
  const out: { key: string; size: number; modificado: Date | null }[] = [];
  let token: string | undefined;
  do {
    const r = await client().send(
      new ListObjectsV2Command({ Bucket: config().bucket, Prefix: prefix, ContinuationToken: token })
    );
    for (const o of r.Contents ?? []) out.push({ key: o.Key!, size: o.Size ?? 0, modificado: o.LastModified ?? null });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export function contentTypePorNome(nome: string): string {
  const e = nome.toLowerCase().split(".").pop() ?? "";
  const m: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    pfx: "application/x-pkcs12", p12: "application/x-pkcs12", doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xml: "application/xml",
  };
  return m[e] ?? "application/octet-stream";
}
