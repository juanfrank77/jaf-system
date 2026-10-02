-- Warehouse foundation: rename the van-scoped ledger to the unified `stock_movement`
-- ledger (DATA-PRESERVING), extend it, and add the warehouse tables/enums.
--
-- This is the SINGLE, COMPLETE warehouse schema change (rename + extend + `note` +
-- warehouse tables/enums). It must not be split across several migrations, and it must
-- not be regenerated.
--
-- Hand-edited from Prisma's generated DROP/CREATE to `ALTER ... RENAME` so existing
-- prod `van_movement` rows survive. This migration + the renamed application code must
-- deploy together (a rename is not backward-compatible). Do NOT let a future
-- regeneration revert the RENAMEs to DROP/CREATE.

-- 1. Rename the movement enum (the ledger's `type` column follows automatically), then extend it.
ALTER TYPE "VanMovementType" RENAME TO "StockMovementType";
ALTER TYPE "StockMovementType" ADD VALUE 'RECEIVE';
ALTER TYPE "StockMovementType" ADD VALUE 'RELEASE';
ALTER TYPE "StockMovementType" ADD VALUE 'STARTING_BALANCE';
ALTER TYPE "StockMovementType" ADD VALUE 'DISPOSITION';
ALTER TYPE "StockMovementType" ADD VALUE 'SENT_FOR_REPAIR';
ALTER TYPE "StockMovementType" ADD VALUE 'REPAIR_INTAKE';

-- 2. New enums.
CREATE TYPE "MovementKind" AS ENUM ('SERIAL', 'BULK');
CREATE TYPE "SerialCondition" AS ENUM ('NEW', 'REFURBISHED');
CREATE TYPE "RepairBatchStatus" AS ENUM ('SENT', 'VOIDED');

-- 3. SerialStatus additions.
ALTER TYPE "SerialStatus" ADD VALUE 'NEEDS_REVIEW';
ALTER TYPE "SerialStatus" ADD VALUE 'AWAITING_REPAIR';
ALTER TYPE "SerialStatus" ADD VALUE 'LOST';

-- 4. SerialLocation.condition.
ALTER TABLE "serial_location" ADD COLUMN     "condition" "SerialCondition" NOT NULL DEFAULT 'NEW';

-- 5. Rename the table (preserves rows, PK, indexes, and the existing RESTRICT FKs),
--    then rename its constraints/indexes to the `stock_movement_*` names Prisma expects.
ALTER TABLE "van_movement" RENAME TO "stock_movement";
ALTER TABLE "stock_movement" RENAME CONSTRAINT "van_movement_pkey" TO "stock_movement_pkey";
ALTER INDEX "van_movement_vanId_serviceCodeId_idx" RENAME TO "stock_movement_vanId_serviceCodeId_idx";
ALTER INDEX "van_movement_serial_idx" RENAME TO "stock_movement_serial_idx";
ALTER TABLE "stock_movement" RENAME CONSTRAINT "van_movement_vanId_fkey" TO "stock_movement_vanId_fkey";
ALTER TABLE "stock_movement" RENAME CONSTRAINT "van_movement_byUserId_fkey" TO "stock_movement_byUserId_fkey";

-- 6. Extend the ledger: new columns (including `note`) + make vanId nullable
--    (warehouse rows have no van).
ALTER TABLE "stock_movement"
  ADD COLUMN     "warehouseId" TEXT,
  ADD COLUMN     "kind" "MovementKind" NOT NULL DEFAULT 'SERIAL',
  ADD COLUMN     "refRepairBatchId" TEXT,
  ADD COLUMN     "refRepairIntakeId" TEXT,
  ADD COLUMN     "refDeliveryId" TEXT,
  ADD COLUMN     "refDocId" TEXT,
  ADD COLUMN     "note" TEXT,
  ALTER COLUMN "vanId" DROP NOT NULL;

-- 7. One-time backfill: existing accessory (non-serialized) rows are BULK.
UPDATE "stock_movement" SET "kind" = 'BULK' WHERE "serial" IS NULL;

-- 8. Exactly one location context per row (van OR warehouse). Hand-maintained CHECK
--    (Prisma cannot express it) — preserve on any future migration hand-edit.
ALTER TABLE "stock_movement"
  ADD CONSTRAINT "stock_movement_location_ck"
  CHECK ((("vanId" IS NOT NULL)::int + ("warehouseId" IS NOT NULL)::int) = 1);

-- 9. New warehouse on-hand index + warehouse FK (RESTRICT, matching the existing vanId FK).
CREATE INDEX "stock_movement_warehouseId_serviceCodeId_idx" ON "stock_movement"("warehouseId", "serviceCodeId");
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 10. New warehouse tables.
CREATE TABLE "RepairBatch" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "RepairBatchStatus" NOT NULL DEFAULT 'SENT',
    "createdById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "documentPath" TEXT,
    "claroReference" TEXT,
    "notes" TEXT,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "RepairBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RepairIntake" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "receivedById" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "declaredCount" INTEGER NOT NULL,
    "documentPath" TEXT,
    "mismatchNote" TEXT,
    "claroReference" TEXT,
    "notes" TEXT,

    CONSTRAINT "RepairIntake_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockDelivery" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "receivedById" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "notes" TEXT,

    CONSTRAINT "StockDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockSnapshot" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentPath" TEXT,
    "csvPath" TEXT,

    CONSTRAINT "StockSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- 11. New tables' indexes.
CREATE INDEX "RepairBatch_warehouseId_status_idx" ON "RepairBatch"("warehouseId", "status");
CREATE INDEX "RepairIntake_warehouseId_idx" ON "RepairIntake"("warehouseId");
CREATE INDEX "StockDelivery_warehouseId_receivedAt_idx" ON "StockDelivery"("warehouseId", "receivedAt");
CREATE INDEX "StockSnapshot_warehouseId_asOfDate_idx" ON "StockSnapshot"("warehouseId", "asOfDate");
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

-- 12. New tables' foreign keys.
ALTER TABLE "RepairBatch" ADD CONSTRAINT "RepairBatch_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepairBatch" ADD CONSTRAINT "RepairBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepairBatch" ADD CONSTRAINT "RepairBatch_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RepairIntake" ADD CONSTRAINT "RepairIntake_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepairIntake" ADD CONSTRAINT "RepairIntake_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockDelivery" ADD CONSTRAINT "StockDelivery_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockDelivery" ADD CONSTRAINT "StockDelivery_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockSnapshot" ADD CONSTRAINT "StockSnapshot_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockSnapshot" ADD CONSTRAINT "StockSnapshot_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
