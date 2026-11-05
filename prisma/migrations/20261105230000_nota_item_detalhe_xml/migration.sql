-- Cache dos detalhes lidos do XML (unidade, desconto, IPI, ICMS ST) por item de nota.
-- O XML de uma nota nunca muda; ler uma vez evita reprocessar centenas de notas a cada abertura do relatório.
CREATE TABLE "NotaItemDetalheXml" (
    "itemId" TEXT NOT NULL,
    "unidade" TEXT NOT NULL DEFAULT '',
    "desconto" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "ipi" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "icmsSt" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotaItemDetalheXml_pkey" PRIMARY KEY ("itemId")
);
