-- AlterTable
ALTER TABLE "jaf_invoice" ADD COLUMN     "bankInvoicePdfPath" TEXT,
ADD COLUMN     "bankScheduleId" TEXT;

-- CreateTable
CREATE TABLE "BankSchedule" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT NOT NULL,
    "advanceRate" DECIMAL(65,30) NOT NULL,
    "total" DECIMAL(65,30) NOT NULL,
    "advanceAmount" DECIMAL(65,30) NOT NULL,
    "xlsxPath" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,

    CONSTRAINT "BankSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankSchedule_number_key" ON "BankSchedule"("number");

-- CreateIndex
CREATE INDEX "BankSchedule_generatedAt_idx" ON "BankSchedule"("generatedAt");

-- CreateIndex
CREATE INDEX "jaf_invoice_bankScheduleId_idx" ON "jaf_invoice"("bankScheduleId");

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_bankScheduleId_fkey" FOREIGN KEY ("bankScheduleId") REFERENCES "BankSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankSchedule" ADD CONSTRAINT "BankSchedule_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankSchedule" ADD CONSTRAINT "BankSchedule_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
