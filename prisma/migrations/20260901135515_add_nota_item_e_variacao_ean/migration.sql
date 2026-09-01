-- AlterTable
ALTER TABLE "VariacaoProduto" ADD COLUMN     "cor" TEXT,
ADD COLUMN     "ean" TEXT,
ADD COLUMN     "tamanho" TEXT;

-- CreateTable
CREATE TABLE "NotaItem" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "codigoProduto" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ean" TEXT,
    "ncm" TEXT,
    "cfop" TEXT,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "valorUnitario" DECIMAL(14,2) NOT NULL,
    "valorTotal" DECIMAL(14,2) NOT NULL,
    "modeloIdentificado" TEXT,
    "referenciaFornecedorIdentificada" TEXT,
    "referenciaComRegraEspecifica" BOOLEAN NOT NULL DEFAULT false,
    "temCadastro" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotaItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotaItem_noteId_idx" ON "NotaItem"("noteId");

-- CreateIndex
CREATE INDEX "NotaItem_ean_idx" ON "NotaItem"("ean");

-- CreateIndex
CREATE INDEX "NotaItem_temCadastro_idx" ON "NotaItem"("temCadastro");

-- CreateIndex
CREATE INDEX "NotaItem_referenciaComRegraEspecifica_idx" ON "NotaItem"("referenciaComRegraEspecifica");

-- CreateIndex
CREATE INDEX "VariacaoProduto_ean_idx" ON "VariacaoProduto"("ean");

-- AddForeignKey
ALTER TABLE "NotaItem" ADD CONSTRAINT "NotaItem_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
