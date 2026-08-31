-- CreateTable
CREATE TABLE "EmpresaLoja" (
    "codigo" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,

    CONSTRAINT "EmpresaLoja_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "GrupoLoja" (
    "codigo" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,

    CONSTRAINT "GrupoLoja_pkey" PRIMARY KEY ("codigo")
);
