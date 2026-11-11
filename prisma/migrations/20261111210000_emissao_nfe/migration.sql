-- CreateTable
CREATE TABLE "EmissaoNfe" (
    "id" TEXT NOT NULL,
    "lojaCnpj" TEXT NOT NULL,
    "ambiente" INTEGER NOT NULL,
    "serie" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "chave" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cStat" TEXT,
    "xMotivo" TEXT,
    "nProt" TEXT,
    "dhRecbto" TIMESTAMP(3),
    "vNF" TEXT NOT NULL,
    "notaOriginalChave" TEXT NOT NULL,
    "notaOriginalNumero" TEXT NOT NULL,
    "caso" TEXT NOT NULL,
    "infCpl" TEXT NOT NULL,
    "contador" BOOLEAN NOT NULL DEFAULT true,
    "selecao" JSONB NOT NULL,
    "xmlOriginal" TEXT NOT NULL,
    "xmlAssinado" TEXT,
    "xmlAutorizado" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmissaoNfe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmissaoNfe_chave_key" ON "EmissaoNfe"("chave");

-- CreateIndex
CREATE UNIQUE INDEX "EmissaoNfe_lojaCnpj_ambiente_serie_numero_key" ON "EmissaoNfe"("lojaCnpj", "ambiente", "serie", "numero");

-- CreateIndex
CREATE INDEX "EmissaoNfe_lojaCnpj_ambiente_idx" ON "EmissaoNfe"("lojaCnpj", "ambiente");
