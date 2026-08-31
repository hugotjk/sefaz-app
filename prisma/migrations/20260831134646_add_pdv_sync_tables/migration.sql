-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL,
    "redeId" INTEGER NOT NULL,
    "nome" TEXT,
    "referenciaFornecedor" TEXT,
    "fornecedorId" TEXT,
    "fornecedorNome" TEXT,
    "modeloId" TEXT,
    "modeloNome" TEXT,
    "colecaoId" INTEGER,
    "colecaoNome" TEXT,
    "grupoId" INTEGER,
    "grupoNome" TEXT,
    "compradorId" TEXT,
    "compradorNome" TEXT,
    "precoVarejoAtual" DECIMAL(14,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariacaoProduto" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "redeId" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariacaoProduto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendaItemSync" (
    "id" TEXT NOT NULL,
    "variacaoId" TEXT NOT NULL,
    "lojaId" INTEGER NOT NULL,
    "dataHora" TIMESTAMP(3) NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendaItemSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstoqueVariacaoSync" (
    "variacaoId" TEXT NOT NULL,
    "lojaId" INTEGER NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstoqueVariacaoSync_pkey" PRIMARY KEY ("variacaoId","lojaId")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("chave")
);

-- CreateIndex
CREATE INDEX "Produto_redeId_idx" ON "Produto"("redeId");

-- CreateIndex
CREATE INDEX "VariacaoProduto_produtoId_idx" ON "VariacaoProduto"("produtoId");

-- CreateIndex
CREATE INDEX "VendaItemSync_variacaoId_idx" ON "VendaItemSync"("variacaoId");

-- CreateIndex
CREATE INDEX "VendaItemSync_lojaId_idx" ON "VendaItemSync"("lojaId");

-- CreateIndex
CREATE INDEX "VendaItemSync_dataHora_idx" ON "VendaItemSync"("dataHora");

-- CreateIndex
CREATE INDEX "EstoqueVariacaoSync_lojaId_idx" ON "EstoqueVariacaoSync"("lojaId");

-- AddForeignKey
ALTER TABLE "VariacaoProduto" ADD CONSTRAINT "VariacaoProduto_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
