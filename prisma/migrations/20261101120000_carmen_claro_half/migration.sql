-- AlterTable
ALTER TABLE "AdviceLine" ADD COLUMN     "ewitInvoiceId" TEXT;

-- AlterTable
ALTER TABLE "EwitInvoice" ADD COLUMN     "aribaSentAt" TIMESTAMP(3),
ADD COLUMN     "aribaSentById" TEXT,
ADD COLUMN     "claroBankRef" TEXT,
ADD COLUMN     "claroPaidAt" TIMESTAMP(3),
ADD COLUMN     "claroPaidNet" DECIMAL(65,30),
ADD COLUMN     "claroTotal" DECIMAL(65,30),
ADD COLUMN     "ivuAmount" DECIMAL(65,30),
ADD COLUMN     "ivuRate" DECIMAL(65,30),
ADD COLUMN     "poDate" TIMESTAMP(3),
ADD COLUMN     "poFilePath" TEXT,
ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "shortAcceptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "installer_profile" ADD COLUMN     "ewitInstallerNo" TEXT;

-- CreateIndex
CREATE INDEX "AdviceLine_ewitInvoiceId_idx" ON "AdviceLine"("ewitInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "installer_profile_ewitInstallerNo_key" ON "installer_profile"("ewitInstallerNo");

-- AddForeignKey
ALTER TABLE "AdviceLine" ADD CONSTRAINT "AdviceLine_ewitInvoiceId_fkey" FOREIGN KEY ("ewitInvoiceId") REFERENCES "EwitInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EwitInvoice" ADD CONSTRAINT "EwitInvoice_aribaSentById_fkey" FOREIGN KEY ("aribaSentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

