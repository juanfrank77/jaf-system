
-- CreateEnum
CREATE TYPE "AdviceResult" AS ENUM ('MATCHED', 'SHORT', 'UNMATCHED', 'ALREADY_PAID');

-- AlterTable
ALTER TABLE "ClaroInvoice" ADD COLUMN     "bankReference" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paidNet" DECIMAL(65,30),
ADD COLUMN     "shortAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "shortAcceptedById" TEXT,
ADD COLUMN     "shortReason" TEXT,
ADD COLUMN     "voucherId" TEXT;

-- CreateTable
CREATE TABLE "PaymentAdvice" (
    "id" TEXT NOT NULL,
    "adviceDate" TIMESTAMP(3) NOT NULL,
    "bank" TEXT,
    "reference" TEXT,
    "total" DECIMAL(65,30) NOT NULL,
    "rowsTotal" DECIMAL(65,30) NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "appliedById" TEXT,

    CONSTRAINT "PaymentAdvice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdviceLine" (
    "id" TEXT NOT NULL,
    "adviceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "invoiceRef" TEXT NOT NULL,
    "voucher" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "amount" DECIMAL(65,30) NOT NULL,
    "withholding" DECIMAL(65,30) NOT NULL,
    "discount" DECIMAL(65,30) NOT NULL,
    "net" DECIMAL(65,30) NOT NULL,
    "result" "AdviceResult" NOT NULL,
    "invoiceId" TEXT,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "AdviceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAdvice_fileHash_key" ON "PaymentAdvice"("fileHash");

-- CreateIndex
CREATE INDEX "PaymentAdvice_adviceDate_idx" ON "PaymentAdvice"("adviceDate");

-- CreateIndex
CREATE INDEX "AdviceLine_adviceId_idx" ON "AdviceLine"("adviceId");

-- CreateIndex
CREATE INDEX "AdviceLine_invoiceId_idx" ON "AdviceLine"("invoiceId");

-- AddForeignKey
ALTER TABLE "ClaroInvoice" ADD CONSTRAINT "ClaroInvoice_shortAcceptedById_fkey" FOREIGN KEY ("shortAcceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAdvice" ADD CONSTRAINT "PaymentAdvice_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAdvice" ADD CONSTRAINT "PaymentAdvice_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdviceLine" ADD CONSTRAINT "AdviceLine_adviceId_fkey" FOREIGN KEY ("adviceId") REFERENCES "PaymentAdvice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdviceLine" ADD CONSTRAINT "AdviceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "ClaroInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

