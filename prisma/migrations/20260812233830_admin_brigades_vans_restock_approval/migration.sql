/*
  Warnings:

  - You are about to drop the column `releaseSignedAt` on the `VanRestockRequest` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "VanRestockRequest" DROP COLUMN "releaseSignedAt",
ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "deniedReason" TEXT,
ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false;

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

-- CreateIndex
CREATE INDEX "Brigade_active_idx" ON "Brigade"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Van_installerId_key" ON "Van"("installerId");

-- CreateIndex
CREATE INDEX "Van_active_idx" ON "Van"("active");

-- AddForeignKey
ALTER TABLE "Van" ADD CONSTRAINT "Van_installerId_fkey" FOREIGN KEY ("installerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanRestockRequest" ADD CONSTRAINT "VanRestockRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
