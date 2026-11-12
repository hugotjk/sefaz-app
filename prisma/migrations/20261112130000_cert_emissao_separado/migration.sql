-- Certificado de consulta pode ser pausado sem apagar
ALTER TABLE "Certificate" ADD COLUMN "consultaAtiva" BOOLEAN NOT NULL DEFAULT true;

-- Certificados usados só para emitir NF-e
CREATE TABLE "EmissorCertificado" (
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT,
    "fileName" TEXT NOT NULL,
    "encryptedBlob" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmissorCertificado_pkey" PRIMARY KEY ("cnpj")
);

-- Copia os certificados já enviados para lojas do Emissor (o original continua na consulta até você pausar)
INSERT INTO "EmissorCertificado" ("cnpj","razaoSocial","fileName","encryptedBlob","iv","authTag","validUntil","updatedAt")
SELECT c."cnpj", c."razaoSocial", c."fileName", c."encryptedBlob", c."iv", c."authTag", c."validUntil", CURRENT_TIMESTAMP
FROM "Certificate" c
WHERE c."cnpj" IN (SELECT "cnpj" FROM "EmissorLoja")
ON CONFLICT ("cnpj") DO NOTHING;
