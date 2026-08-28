-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('PENDING', 'ACTIVE', 'PASSWORD_ERROR', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('AUTORIZADA', 'CANCELADA', 'DENEGADA', 'DESCONHECIDA');

-- CreateEnum
CREATE TYPE "NoteEventType" AS ENUM ('CARTA_CORRECAO', 'CANCELAMENTO', 'CIENCIA_OPERACAO', 'CONFIRMACAO_OPERACAO', 'DESCONHECIMENTO_OPERACAO', 'OPERACAO_NAO_REALIZADA', 'OUTRO');

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT,
    "fileName" TEXT NOT NULL,
    "encryptedBlob" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "ultNSU" TEXT NOT NULL DEFAULT '000000000000000',
    "maxNSU" TEXT NOT NULL DEFAULT '000000000000000',
    "backfillDone" BOOLEAN NOT NULL DEFAULT false,
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "chaveAcesso" TEXT NOT NULL,
    "cnpjDestino" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "numero" TEXT,
    "serie" TEXT,
    "emitenteCnpj" TEXT,
    "emitenteNome" TEXT,
    "valorTotal" DECIMAL(14,2),
    "dataEmissao" TIMESTAMP(3),
    "status" "NoteStatus" NOT NULL DEFAULT 'AUTORIZADA',
    "xmlCompleto" TEXT NOT NULL,
    "nsu" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteEvent" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "tipo" "NoteEventType" NOT NULL,
    "descricao" TEXT,
    "xmlEvento" TEXT NOT NULL,
    "nsu" TEXT NOT NULL,
    "dataEvento" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_cnpj_key" ON "Certificate"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "Note_chaveAcesso_key" ON "Note"("chaveAcesso");

-- CreateIndex
CREATE INDEX "Note_cnpjDestino_idx" ON "Note"("cnpjDestino");

-- CreateIndex
CREATE INDEX "Note_emitenteCnpj_idx" ON "Note"("emitenteCnpj");

-- CreateIndex
CREATE INDEX "NoteEvent_noteId_idx" ON "NoteEvent"("noteId");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteEvent" ADD CONSTRAINT "NoteEvent_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
