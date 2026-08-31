-- CreateTable
CREATE TABLE "FilialSync" (
    "lojaId" INTEGER NOT NULL,
    "nome" TEXT,
    "empresaId" INTEGER,
    "grupoId" INTEGER,
    "supervisor" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilialSync_pkey" PRIMARY KEY ("lojaId")
);
