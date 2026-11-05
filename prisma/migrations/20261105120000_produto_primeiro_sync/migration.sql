-- AlterTable: quando o app viu o produto pela 1ª vez
ALTER TABLE "Produto" ADD COLUMN "primeiroSyncEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Os produtos que já existiam não são "recém-cadastrados".
UPDATE "Produto" SET "primeiroSyncEm" = '2000-01-01 00:00:00';
