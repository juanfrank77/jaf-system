/*
  Warnings:

  - The values [COMPTOLLER] on the enum `Role` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `releaseSignedAt` on the `VanRestockRequest` table. All the data in the column will be lost.

*/
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('SUPERVISOR', 'CREW', 'WAREHOUSE', 'FINANCE', 'ADMIN', 'INSTALLER', 'COMPTROLLER');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
COMMIT;

-- AlterTable
ALTER TABLE "VanRestockRequest" DROP COLUMN "releaseSignedAt",
ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "deniedReason" TEXT,
ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "jaf_invoice" ADD COLUMN     "addressCorrections" JSONB,
ADD COLUMN     "completedById" TEXT,
ADD COLUMN     "completionSignature" TEXT,
ADD COLUMN     "completionSignedAt" TIMESTAMP(3),
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "fieldSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "finalClaroDocPath" TEXT,
ADD COLUMN     "finalClaroUploadedAt" TIMESTAMP(3),
ADD COLUMN     "financeSendBackNotes" JSONB,
ADD COLUMN     "financeVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "financeVerifiedById" TEXT,
ADD COLUMN     "gpsCoordinates" JSONB,
ADD COLUMN     "karmenCopySentAt" TIMESTAMP(3),
ADD COLUMN     "pbccRequestPdfPath" TEXT,
ADD COLUMN     "pbccRequestSentAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Brigade" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "memberIds" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brigade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Van" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "installerId" TEXT,
    "standardStockLevels" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Van_pkey" PRIMARY KEY ("id")
);

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
CREATE INDEX "Brigade_active_idx" ON "Brigade"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Van_installerId_key" ON "Van"("installerId");

-- CreateIndex
CREATE INDEX "Van_active_idx" ON "Van"("active");

-- CreateIndex
CREATE INDEX "install_log_installerId_date_idx" ON "install_log"("installerId", "date");

-- CreateIndex
CREATE INDEX "install_log_vanId_date_idx" ON "install_log"("vanId", "date");

-- CreateIndex
CREATE INDEX "van_inventory_transaction_vanId_serviceCodeId_idx" ON "van_inventory_transaction"("vanId", "serviceCodeId");

-- CreateIndex
CREATE INDEX "van_inventory_transaction_type_createdAt_idx" ON "van_inventory_transaction"("type", "createdAt");

-- CreateIndex
CREATE INDEX "jaf_invoice_status_financeVerifiedAt_pbccRequestSentAt_adva_idx" ON "jaf_invoice"("status", "financeVerifiedAt", "pbccRequestSentAt", "advanceReceivedAt");

-- CreateIndex
CREATE INDEX "jaf_invoice_avisoNumber_idx" ON "jaf_invoice" USING GIN ("avisoNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "jaf_invoice_jobAddressEstimated_idx" ON "jaf_invoice" USING GIN ("jobAddressEstimated" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_financeVerifiedById_fkey" FOREIGN KEY ("financeVerifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Van" ADD CONSTRAINT "Van_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanRestockRequest" ADD CONSTRAINT "VanRestockRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "install_log" ADD CONSTRAINT "install_log_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "install_log" ADD CONSTRAINT "install_log_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "van_inventory_transaction" ADD CONSTRAINT "van_inventory_transaction_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "van_inventory_transaction" ADD CONSTRAINT "van_inventory_transaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
