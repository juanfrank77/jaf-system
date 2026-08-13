-- AlterTable
ALTER TABLE "jaf_invoice" ADD COLUMN     "addressCorrections" JSONB,
ADD COLUMN     "completedById" TEXT,
ADD COLUMN     "completionSignature" TEXT,
ADD COLUMN     "completionSignedAt" TIMESTAMP(3),
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "fieldSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "gpsCoordinates" JSONB,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
