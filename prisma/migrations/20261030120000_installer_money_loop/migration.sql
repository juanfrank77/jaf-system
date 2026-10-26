-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "href" TEXT;

-- AlterTable
ALTER TABLE "install_completion" ADD COLUMN     "ewitInvoiceId" TEXT,
ADD COLUMN     "installerPaymentId" TEXT,
ADD COLUMN     "orderNoCorrections" JSONB,
ADD COLUMN     "paidBeforePbccReason" TEXT;

-- CreateTable
CREATE TABLE "EwitInvoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "total" DECIMAL(65,30) NOT NULL,
    "filePath" TEXT NOT NULL,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "heldAt" TIMESTAMP(3),
    "holdReason" TEXT,
    "unmatchedOrderNos" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "EwitInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EwitBatch" (
    "id" TEXT NOT NULL,
    "number" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,
    "xlsxPath" TEXT,
    "receivedAt" TIMESTAMP(3),
    "receivedAmount" DECIMAL(65,30),
    "receivedById" TEXT,
    "statementPath" TEXT,

    CONSTRAINT "EwitBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallerPayment" (
    "id" TEXT NOT NULL,
    "installerId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "paidById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoReason" TEXT,

    CONSTRAINT "InstallerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentReport" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "pdfPath" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),

    CONSTRAINT "SentReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EwitInvoice_number_key" ON "EwitInvoice"("number");

-- CreateIndex
CREATE INDEX "EwitInvoice_batchId_idx" ON "EwitInvoice"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "EwitBatch_number_key" ON "EwitBatch"("number");

-- CreateIndex
CREATE INDEX "InstallerPayment_installerId_paidAt_idx" ON "InstallerPayment"("installerId", "paidAt");

-- CreateIndex
CREATE INDEX "SentReport_toId_sentAt_idx" ON "SentReport"("toId", "sentAt");

-- CreateIndex
CREATE INDEX "install_completion_ewitInvoiceId_idx" ON "install_completion"("ewitInvoiceId");

-- CreateIndex
CREATE INDEX "install_completion_installerPaymentId_idx" ON "install_completion"("installerPaymentId");

-- AddForeignKey
ALTER TABLE "install_completion" ADD CONSTRAINT "install_completion_ewitInvoiceId_fkey" FOREIGN KEY ("ewitInvoiceId") REFERENCES "EwitInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "install_completion" ADD CONSTRAINT "install_completion_installerPaymentId_fkey" FOREIGN KEY ("installerPaymentId") REFERENCES "InstallerPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EwitInvoice" ADD CONSTRAINT "EwitInvoice_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "EwitBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EwitInvoice" ADD CONSTRAINT "EwitInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EwitInvoice" ADD CONSTRAINT "EwitInvoice_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EwitBatch" ADD CONSTRAINT "EwitBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EwitBatch" ADD CONSTRAINT "EwitBatch_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EwitBatch" ADD CONSTRAINT "EwitBatch_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EwitBatch" ADD CONSTRAINT "EwitBatch_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallerPayment" ADD CONSTRAINT "InstallerPayment_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallerPayment" ADD CONSTRAINT "InstallerPayment_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentReport" ADD CONSTRAINT "SentReport_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentReport" ADD CONSTRAINT "SentReport_toId_fkey" FOREIGN KEY ("toId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

