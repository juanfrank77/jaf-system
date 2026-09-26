/*
  Warnings:

  - You are about to drop the column `standardStockLevels` on the `Van` table. All the data in the column will be lost.
  - You are about to drop the `ConsignmentReceipt` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `VanRestockRequest` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `install_log` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `van_inventory_transaction` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "SerialStatus" AS ENUM ('WAREHOUSE', 'VAN', 'INSTALLED', 'REMOVED_PENDING_RETURN', 'RETURNED', 'SENT_FOR_REPAIR');

-- CreateEnum
CREATE TYPE "VanMovementType" AS ENUM ('PICKUP', 'INSTALL', 'SWAP_OUT', 'SWAP_IN', 'RETURN', 'ADJUST');

-- CreateEnum
CREATE TYPE "CompletionStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "SwapReason" AS ENUM ('HARDWARE', 'INSTALL_DEFECT', 'CUSTOMER', 'LINE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentRequestKind" AS ENUM ('INSTALL', 'CALLBACK');

-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('INCOMPLETE', 'READY', 'PAID');

-- CreateEnum
CREATE TYPE "RestockStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'NEEDS_SIGNOFF', 'APPROVED', 'PICKED', 'RECEIVED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'INSTALLER_SUPERVISOR';

-- DropForeignKey
ALTER TABLE "ConsignmentReceipt" DROP CONSTRAINT "ConsignmentReceipt_receivedById_fkey";

-- DropForeignKey
ALTER TABLE "ConsignmentReceipt" DROP CONSTRAINT "ConsignmentReceipt_warehouseId_fkey";

-- DropForeignKey
ALTER TABLE "VanRestockRequest" DROP CONSTRAINT "VanRestockRequest_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "VanRestockRequest" DROP CONSTRAINT "VanRestockRequest_overriddenById_fkey";

-- DropForeignKey
ALTER TABLE "VanRestockRequest" DROP CONSTRAINT "VanRestockRequest_receiverSignedById_fkey";

-- DropForeignKey
ALTER TABLE "VanRestockRequest" DROP CONSTRAINT "VanRestockRequest_releasedById_fkey";

-- DropForeignKey
ALTER TABLE "VanRestockRequest" DROP CONSTRAINT "VanRestockRequest_requestedById_fkey";

-- DropForeignKey
ALTER TABLE "VanRestockRequest" DROP CONSTRAINT "VanRestockRequest_warehouseId_fkey";

-- DropForeignKey
ALTER TABLE "install_log" DROP CONSTRAINT "install_log_installerId_fkey";

-- DropForeignKey
ALTER TABLE "install_log" DROP CONSTRAINT "install_log_vanId_fkey";

-- DropForeignKey
ALTER TABLE "van_inventory_transaction" DROP CONSTRAINT "van_inventory_transaction_createdById_fkey";

-- DropForeignKey
ALTER TABLE "van_inventory_transaction" DROP CONSTRAINT "van_inventory_transaction_vanId_fkey";

-- AlterTable
ALTER TABLE "ServiceCode" ADD COLUMN     "serialPrefix" TEXT,
ADD COLUMN     "serialized" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Van" DROP COLUMN "standardStockLevels";

-- DropTable
DROP TABLE "ConsignmentReceipt";

-- DropTable
DROP TABLE "VanRestockRequest";

-- DropTable
DROP TABLE "install_log";

-- DropTable
DROP TABLE "van_inventory_transaction";

-- CreateTable
CREATE TABLE "installer_profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jafNumber" TEXT NOT NULL,
    "toaNumber" TEXT NOT NULL,
    "region" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installer_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "van_par" (
    "id" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "serviceCodeId" TEXT NOT NULL,
    "parQty" INTEGER NOT NULL,

    CONSTRAINT "van_par_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "limit_table" (
    "id" TEXT NOT NULL,
    "bracketFt" INTEGER NOT NULL,
    "serviceCodeId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "limit_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serial_location" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "serviceCodeId" TEXT NOT NULL,
    "status" "SerialStatus" NOT NULL,
    "currentRef" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serial_location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "van_movement" (
    "id" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "serviceCodeId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "serial" TEXT,
    "type" "VanMovementType" NOT NULL,
    "refCompletionId" TEXT,
    "refSwapId" TEXT,
    "refRestockId" TEXT,
    "byUserId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "van_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "install_completion" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "claroOrderNo" TEXT NOT NULL,
    "installerId" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "status" "CompletionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "address" TEXT NOT NULL,
    "addressEditLog" JSONB,
    "gpsLat" DOUBLE PRECISION,
    "gpsLng" DOUBLE PRECISION,
    "dropFt" INTEGER,
    "plantRefs" JSONB,
    "accessories" JSONB,
    "groundRod" BOOLEAN NOT NULL DEFAULT true,
    "coaxFt" INTEGER,
    "serialInstalled" TEXT,
    "serialUnreadable" BOOLEAN NOT NULL DEFAULT false,
    "serialNotOnVan" BOOLEAN NOT NULL DEFAULT false,
    "modelResolved" TEXT,
    "formPhotoPath" TEXT,
    "labelPhotoPath" TEXT,
    "extraPhotoPaths" TEXT[],
    "sigInstaller" TEXT,
    "sigInstallerAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3),
    "completionPdfPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "install_completion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "swap_event" (
    "id" TEXT NOT NULL,
    "completionId" TEXT NOT NULL,
    "serialOut" TEXT NOT NULL,
    "serialOutPhotoPath" TEXT,
    "serialOutMatchedRecord" BOOLEAN NOT NULL DEFAULT true,
    "reason" "SwapReason" NOT NULL,
    "serialIn" TEXT NOT NULL,
    "serialInPhotoPath" TEXT,
    "serialInNotOnVan" BOOLEAN NOT NULL DEFAULT false,
    "newClaroOrderNo" TEXT,
    "daysSinceInstall" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byInstallerId" TEXT NOT NULL,

    CONSTRAINT "swap_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_request" (
    "id" TEXT NOT NULL,
    "kind" "PaymentRequestKind" NOT NULL,
    "completionId" TEXT,
    "swapId" TEXT,
    "installerId" TEXT NOT NULL,
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'READY',
    "missing" TEXT[],
    "daysSinceInstall" INTEGER,
    "attachments" JSONB,
    "paidAt" TIMESTAMP(3),
    "paidRef" TEXT,
    "paidByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restock_request" (
    "id" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "status" "RestockStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "releaseId" TEXT,

    CONSTRAINT "restock_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "installer_profile_userId_key" ON "installer_profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "installer_profile_toaNumber_key" ON "installer_profile"("toaNumber");

-- CreateIndex
CREATE UNIQUE INDEX "van_par_vanId_serviceCodeId_key" ON "van_par"("vanId", "serviceCodeId");

-- CreateIndex
CREATE INDEX "limit_table_bracketFt_idx" ON "limit_table"("bracketFt");

-- CreateIndex
CREATE UNIQUE INDEX "limit_table_bracketFt_serviceCodeId_key" ON "limit_table"("bracketFt", "serviceCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "serial_location_serial_key" ON "serial_location"("serial");

-- CreateIndex
CREATE INDEX "serial_location_status_currentRef_idx" ON "serial_location"("status", "currentRef");

-- CreateIndex
CREATE INDEX "van_movement_vanId_serviceCodeId_idx" ON "van_movement"("vanId", "serviceCodeId");

-- CreateIndex
CREATE INDEX "van_movement_serial_idx" ON "van_movement"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "install_completion_idempotencyKey_key" ON "install_completion"("idempotencyKey");

-- CreateIndex
CREATE INDEX "install_completion_installerId_createdAt_idx" ON "install_completion"("installerId", "createdAt");

-- CreateIndex
CREATE INDEX "install_completion_claroOrderNo_idx" ON "install_completion"("claroOrderNo");

-- CreateIndex
CREATE INDEX "swap_event_completionId_idx" ON "swap_event"("completionId");

-- CreateIndex
CREATE INDEX "payment_request_status_createdAt_idx" ON "payment_request"("status", "createdAt");

-- CreateIndex
CREATE INDEX "payment_request_installerId_createdAt_idx" ON "payment_request"("installerId", "createdAt");

-- CreateIndex
CREATE INDEX "restock_request_status_submittedAt_idx" ON "restock_request"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "restock_request_vanId_submittedAt_idx" ON "restock_request"("vanId", "submittedAt");

-- AddForeignKey
ALTER TABLE "installer_profile" ADD CONSTRAINT "installer_profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "van_par" ADD CONSTRAINT "van_par_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "van_movement" ADD CONSTRAINT "van_movement_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "van_movement" ADD CONSTRAINT "van_movement_byUserId_fkey" FOREIGN KEY ("byUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "install_completion" ADD CONSTRAINT "install_completion_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "install_completion" ADD CONSTRAINT "install_completion_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_event" ADD CONSTRAINT "swap_event_completionId_fkey" FOREIGN KEY ("completionId") REFERENCES "install_completion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swap_event" ADD CONSTRAINT "swap_event_byInstallerId_fkey" FOREIGN KEY ("byInstallerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request" ADD CONSTRAINT "payment_request_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request" ADD CONSTRAINT "payment_request_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restock_request" ADD CONSTRAINT "restock_request_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restock_request" ADD CONSTRAINT "restock_request_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
