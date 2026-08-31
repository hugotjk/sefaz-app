-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "ultimaTentativaXml" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Note_ultimaTentativaXml_idx" ON "Note"("ultimaTentativaXml");
