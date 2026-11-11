-- CreateTable
CREATE TABLE "EmissorLoja" (
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "ie" TEXT,
    "im" TEXT,
    "cnae" TEXT,
    "crt" INTEGER NOT NULL,
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "codMunicipio" TEXT,
    "municipio" TEXT,
    "uf" TEXT,
    "cep" TEXT,
    "fone" TEXT,
    "serie" INTEGER,
    "proximoNumero" INTEGER NOT NULL DEFAULT 1,
    "serieAntiga" INTEGER,
    "ultimoNumeroAntigo" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmissorLoja_pkey" PRIMARY KEY ("cnpj")
);
