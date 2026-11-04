-- CreateEnum
CREATE TYPE "BrigadeStockType" AS ENUM ('OPENING', 'PICKUP', 'USED', 'RETURN', 'COUNT');

-- CreateEnum
CREATE TYPE "BrigadeRestockStatus" AS ENUM ('REQUESTED', 'READY', 'PICKED_UP', 'CANCELLED');

-- CreateTable
CREATE TABLE "brigade_stock_movement" (
    "id" TEXT NOT NULL,
    "brigadeId" TEXT NOT NULL,
    "serviceCodeId" TEXT NOT NULL,
    "type" "BrigadeStockType" NOT NULL,
    "qty" INTEGER NOT NULL,
    "expectedQty" INTEGER,
    "countedQty" INTEGER,
    "reason" TEXT,
    "refRestockId" TEXT,
    "refReturnId" TEXT,
    "refDocId" TEXT,
    "byUserId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brigade_stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brigade_restock" (
    "id" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "BrigadeRestockStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "readyById" TEXT,
    "supervisorSignedAt" TIMESTAMP(3),
    "supervisorSignedById" TEXT,
    "warehouseSignedAt" TIMESTAMP(3),
    "warehouseSignedById" TEXT,
    "pickedUpAt" TIMESTAMP(3),

    CONSTRAINT "brigade_restock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brigade_restock_line" (
    "id" TEXT NOT NULL,
    "restockId" TEXT NOT NULL,
    "brigadeId" TEXT NOT NULL,
    "serviceCodeId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "brigade_restock_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brigade_stock_return" (
    "id" TEXT NOT NULL,
    "brigadeId" TEXT NOT NULL,
    "serviceCodeId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "brigade_stock_return_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brigade_stock_movement_brigadeId_serviceCodeId_idx" ON "brigade_stock_movement"("brigadeId", "serviceCodeId");

-- CreateIndex
CREATE INDEX "brigade_stock_movement_refDocId_idx" ON "brigade_stock_movement"("refDocId");

-- CreateIndex
CREATE INDEX "brigade_stock_movement_refRestockId_idx" ON "brigade_stock_movement"("refRestockId");

-- CreateIndex
CREATE INDEX "brigade_restock_status_requestedAt_idx" ON "brigade_restock"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "brigade_restock_requestedById_requestedAt_idx" ON "brigade_restock"("requestedById", "requestedAt");

-- CreateIndex
CREATE INDEX "brigade_restock_line_restockId_idx" ON "brigade_restock_line"("restockId");

-- CreateIndex
CREATE INDEX "brigade_stock_return_confirmedAt_idx" ON "brigade_stock_return"("confirmedAt");

-- CreateIndex
CREATE INDEX "brigade_stock_return_brigadeId_serviceCodeId_idx" ON "brigade_stock_return"("brigadeId", "serviceCodeId");

-- AddForeignKey
ALTER TABLE "brigade_stock_movement" ADD CONSTRAINT "brigade_stock_movement_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brigade_stock_movement" ADD CONSTRAINT "brigade_stock_movement_byUserId_fkey" FOREIGN KEY ("byUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brigade_restock" ADD CONSTRAINT "brigade_restock_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brigade_restock" ADD CONSTRAINT "brigade_restock_readyById_fkey" FOREIGN KEY ("readyById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brigade_restock" ADD CONSTRAINT "brigade_restock_supervisorSignedById_fkey" FOREIGN KEY ("supervisorSignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brigade_restock" ADD CONSTRAINT "brigade_restock_warehouseSignedById_fkey" FOREIGN KEY ("warehouseSignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brigade_restock_line" ADD CONSTRAINT "brigade_restock_line_restockId_fkey" FOREIGN KEY ("restockId") REFERENCES "brigade_restock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brigade_restock_line" ADD CONSTRAINT "brigade_restock_line_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brigade_stock_return" ADD CONSTRAINT "brigade_stock_return_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brigade_stock_return" ADD CONSTRAINT "brigade_stock_return_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brigade_stock_return" ADD CONSTRAINT "brigade_stock_return_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

