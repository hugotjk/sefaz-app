-- CreateTable
CREATE TABLE "NotaDuplicata" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "NotaDuplicata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LojaReferencia" (
    "cnpj" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "loja" TEXT NOT NULL,
    "gestor" TEXT,
    "rede" TEXT,
    "tipoLoja" TEXT,
    "razaoSocial" TEXT,
    "comprador" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LojaReferencia_pkey" PRIMARY KEY ("cnpj")
);

-- CreateIndex
CREATE INDEX "NotaDuplicata_noteId_idx" ON "NotaDuplicata"("noteId");

-- AddForeignKey
ALTER TABLE "NotaDuplicata" ADD CONSTRAINT "NotaDuplicata_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
