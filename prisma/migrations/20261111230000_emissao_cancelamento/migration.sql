-- AlterTable
ALTER TABLE "EmissaoNfe" ADD COLUMN     "canceladaEm" TIMESTAMP(3),
ADD COLUMN     "cancJustificativa" TEXT,
ADD COLUMN     "cancProtocolo" TEXT,
ADD COLUMN     "xmlCancelamento" TEXT;
