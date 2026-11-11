-- CreateTable
CREATE TABLE "EmissaoRascunho" (
    "id" TEXT NOT NULL,
    "lojaCnpj" TEXT NOT NULL,
    "fornecedor" TEXT NOT NULL,
    "notaOriginalNumero" TEXT NOT NULL,
    "caso" TEXT NOT NULL DEFAULT '',
    "infCpl" TEXT,
    "contador" BOOLEAN NOT NULL DEFAULT true,
    "selecao" JSONB NOT NULL,
    "xmlOriginal" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmissaoRascunho_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmissaoRascunho_lojaCnpj_idx" ON "EmissaoRascunho"("lojaCnpj");
