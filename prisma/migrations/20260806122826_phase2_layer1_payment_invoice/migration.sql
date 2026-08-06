-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('PBCC_ADVANCE', 'CREW_PAYMENT', 'CLARO_FINAL');

-- AlterTable
ALTER TABLE "jaf_invoice" ADD COLUMN     "crewAssignmentHistory" JSONB,
ADD COLUMN     "jafInvoicePdfPath" TEXT,
ADD COLUMN     "prepChangedSincePrep" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "payment_record" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" "PaymentType" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_record_jobId_type_idx" ON "payment_record"("jobId", "type");

-- AddForeignKey
ALTER TABLE "payment_record" ADD CONSTRAINT "payment_record_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jaf_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_record" ADD CONSTRAINT "payment_record_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
