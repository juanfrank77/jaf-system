-- CreateTable
CREATE TABLE "install_log" (
    "id" TEXT NOT NULL,
    "installerId" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "claroJobReference" TEXT NOT NULL,
    "serviceType" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "materialsUsed" JSONB NOT NULL,
    "notes" TEXT,
    "discrepancyFlagged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "install_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "van_inventory_transaction" (
    "id" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "serviceCodeId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "referenceId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "van_inventory_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "install_log_installerId_date_idx" ON "install_log"("installerId", "date");

-- CreateIndex
CREATE INDEX "install_log_vanId_date_idx" ON "install_log"("vanId", "date");

-- CreateIndex
CREATE INDEX "van_inventory_transaction_vanId_serviceCodeId_idx" ON "van_inventory_transaction"("vanId", "serviceCodeId");

-- CreateIndex
CREATE INDEX "van_inventory_transaction_type_createdAt_idx" ON "van_inventory_transaction"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "install_log" ADD CONSTRAINT "install_log_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "install_log" ADD CONSTRAINT "install_log_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "van_inventory_transaction" ADD CONSTRAINT "van_inventory_transaction_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "van_inventory_transaction" ADD CONSTRAINT "van_inventory_transaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
