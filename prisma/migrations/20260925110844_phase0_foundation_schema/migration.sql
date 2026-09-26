-- CreateEnum
CREATE TYPE "Ownership" AS ENUM ('CLARO_CONSIGNED', 'JAF_PURCHASED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "ServiceCode" ADD COLUMN     "canonicalName" TEXT,
ADD COLUMN     "conversionFactor" DECIMAL(65,30),
ADD COLUMN     "countUnit" TEXT,
ADD COLUMN     "ownership" "Ownership" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "reparadoCode" TEXT,
ADD COLUMN     "stockUnit" TEXT;

-- CreateTable
CREATE TABLE "WarehouseAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WarehouseAssignment_warehouseId_isLead_idx" ON "WarehouseAssignment"("warehouseId", "isLead");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseAssignment_userId_warehouseId_key" ON "WarehouseAssignment"("userId", "warehouseId");

-- AddForeignKey
ALTER TABLE "WarehouseAssignment" ADD CONSTRAINT "WarehouseAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseAssignment" ADD CONSTRAINT "WarehouseAssignment_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
