-- AlterTable
ALTER TABLE "FilialSync" ADD COLUMN     "tipoLoja" TEXT;

-- CreateIndex
CREATE INDEX "FilialSync_tipoLoja_idx" ON "FilialSync"("tipoLoja");
