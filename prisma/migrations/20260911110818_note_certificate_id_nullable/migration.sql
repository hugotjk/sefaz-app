-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_certificateId_fkey";

-- AlterTable
ALTER TABLE "Note" ALTER COLUMN "certificateId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
