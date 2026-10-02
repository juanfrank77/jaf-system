-- AlterTable
ALTER TABLE "jaf_invoice" ADD COLUMN     "contractorAccountId" TEXT,
ADD COLUMN     "contractorShareLines" JSONB,
ADD COLUMN     "grossPayable" DECIMAL(65,30),
ADD COLUMN     "netPayable" DECIMAL(65,30),
ADD COLUMN     "payablesClosedAt" TIMESTAMP(3),
ADD COLUMN     "payablesClosedById" TEXT,
ADD COLUMN     "payrollRunId" TEXT,
ADD COLUMN     "retentionAmount" DECIMAL(65,30);

-- CreateTable
CREATE TABLE "ContractorAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "brigadeId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractorAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedById" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "evidencePath" TEXT,
    "confirmedByFallback" BOOLEAN NOT NULL DEFAULT false,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reverseReason" TEXT,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContractorAccount_code_key" ON "ContractorAccount"("code");

-- CreateIndex
CREATE INDEX "ContractorAccount_active_idx" ON "ContractorAccount"("active");

-- CreateIndex
CREATE INDEX "PayrollRun_generatedAt_idx" ON "PayrollRun"("generatedAt");

-- CreateIndex
CREATE INDEX "jaf_invoice_payrollRunId_idx" ON "jaf_invoice"("payrollRunId");

-- CreateIndex
CREATE INDEX "jaf_invoice_contractorAccountId_idx" ON "jaf_invoice"("contractorAccountId");

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_payablesClosedById_fkey" FOREIGN KEY ("payablesClosedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_contractorAccountId_fkey" FOREIGN KEY ("contractorAccountId") REFERENCES "ContractorAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorAccount" ADD CONSTRAINT "ContractorAccount_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
