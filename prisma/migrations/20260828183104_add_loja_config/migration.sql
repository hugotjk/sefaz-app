-- CreateTable
CREATE TABLE "LojaConfig" (
    "lojaId" INTEGER NOT NULL,
    "nome" TEXT,
    "gestor" TEXT,
    "tipoLoja" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LojaConfig_pkey" PRIMARY KEY ("lojaId")
);
