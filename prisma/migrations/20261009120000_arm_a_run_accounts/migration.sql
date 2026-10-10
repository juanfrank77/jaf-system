-- CreateTable
CREATE TABLE "PayrollRunAccount" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "contractorAccountId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "confirmedByFallback" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRunAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollRunAccount_payrollRunId_idx" ON "PayrollRunAccount"("payrollRunId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRunAccount_payrollRunId_contractorAccountId_key" ON "PayrollRunAccount"("payrollRunId", "contractorAccountId");

-- AddForeignKey
ALTER TABLE "PayrollRunAccount" ADD CONSTRAINT "PayrollRunAccount_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunAccount" ADD CONSTRAINT "PayrollRunAccount_contractorAccountId_fkey" FOREIGN KEY ("contractorAccountId") REFERENCES "ContractorAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunAccount" ADD CONSTRAINT "PayrollRunAccount_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
