-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- AlterTable
ALTER TABLE "jaf_invoice" ADD COLUMN     "finalClaroDocPath" TEXT,
ADD COLUMN     "finalClaroUploadedAt" TIMESTAMP(3),
ADD COLUMN     "financeSendBackNotes" JSONB,
ADD COLUMN     "financeVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "financeVerifiedById" TEXT,
ADD COLUMN     "karmenCopySentAt" TIMESTAMP(3),
ADD COLUMN     "pbccRequestPdfPath" TEXT,
ADD COLUMN     "pbccRequestSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "jaf_invoice_status_financeVerifiedAt_pbccRequestSentAt_adva_idx" ON "jaf_invoice"("status", "financeVerifiedAt", "pbccRequestSentAt", "advanceReceivedAt");

-- CreateIndex
CREATE INDEX "jaf_invoice_avisoNumber_idx" ON "jaf_invoice" USING GIN ("avisoNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "jaf_invoice_jobAddressEstimated_idx" ON "jaf_invoice" USING GIN ("jobAddressEstimated" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_financeVerifiedById_fkey" FOREIGN KEY ("financeVerifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
