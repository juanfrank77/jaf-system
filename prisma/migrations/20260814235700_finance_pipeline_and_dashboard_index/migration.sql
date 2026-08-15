-- AlterTable
ALTER TABLE "PoLink" ADD COLUMN     "poDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "jaf_invoice_status_createdAt_idx" ON "jaf_invoice"("status", "createdAt");
