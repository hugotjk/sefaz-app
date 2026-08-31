-- CreateTable
CREATE TABLE "VendaResumoMensal" (
    "variacaoId" TEXT NOT NULL,
    "lojaId" INTEGER NOT NULL,
    "anoMes" TEXT NOT NULL,
    "quantidadeTotal" DECIMAL(14,3) NOT NULL,
    "valorTotal" DECIMAL(14,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendaResumoMensal_pkey" PRIMARY KEY ("variacaoId","lojaId","anoMes")
);

-- CreateTable
CREATE TABLE "PrecoVariacao" (
    "variacaoId" TEXT NOT NULL,
    "preco" DECIMAL(14,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrecoVariacao_pkey" PRIMARY KEY ("variacaoId")
);

-- CreateIndex
CREATE INDEX "VendaResumoMensal_anoMes_idx" ON "VendaResumoMensal"("anoMes");
