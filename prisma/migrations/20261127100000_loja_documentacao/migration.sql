-- Lojas da tela de Documentações (separadas da LojaCadastro, que alimenta o Qive).
CREATE TABLE "LojaDocumentacao" (
    "id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL DEFAULT '',
    "loja" TEXT NOT NULL,
    "razaoSocial" TEXT,
    "gestor" TEXT,
    "rede" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "origem" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LojaDocumentacao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LojaDocumentacao_cnpj_idx" ON "LojaDocumentacao"("cnpj");

CREATE UNIQUE INDEX "LojaDocumentacao_cnpj_loja_key" ON "LojaDocumentacao"("cnpj", "loja");
