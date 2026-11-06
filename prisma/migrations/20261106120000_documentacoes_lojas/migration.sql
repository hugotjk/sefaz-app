-- Cadastro das lojas para a tela de Documentações (vem das planilhas LOJAS e LOJAS_MFPLAI) e documentos guardados.
CREATE TABLE "LojaCadastro" (
    "id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL DEFAULT '',
    "loja" TEXT NOT NULL,
    "razaoSocial" TEXT,
    "gestor" TEXT,
    "rede" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "origem" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LojaCadastro_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LojaCadastro_origem_cnpj_loja_key" ON "LojaCadastro"("origem", "cnpj", "loja");
CREATE INDEX "LojaCadastro_cnpj_idx" ON "LojaCadastro"("cnpj");

CREATE TABLE "DocumentoLoja" (
    "id" TEXT NOT NULL,
    "escopo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nomeArquivo" TEXT NOT NULL,
    "driveItemId" TEXT,
    "tamanho" INTEGER,
    "validade" TIMESTAMP(3),
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentoLoja_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DocumentoLoja_escopo_chave_idx" ON "DocumentoLoja"("escopo", "chave");
