-- AlterTable
ALTER TABLE "jaf_invoice" ADD COLUMN     "jobSeq" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "jaf_invoice_jobSeq_key" ON "jaf_invoice"("jobSeq");
