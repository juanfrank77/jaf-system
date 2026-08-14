-- AlterTable
ALTER TABLE "PoLink" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Account_providerId_accountId_idx" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Photo_docId_idx" ON "Photo"("docId");

-- CreateIndex
CREATE INDEX "PoLink_docId_idx" ON "PoLink"("docId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "VanRestockRequest_status_createdAt_idx" ON "VanRestockRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VanRestockRequest_requestedById_createdAt_idx" ON "VanRestockRequest"("requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "VanRestockRequest_warehouseId_createdAt_idx" ON "VanRestockRequest"("warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE INDEX "Verification_value_idx" ON "Verification"("value");

-- CreateIndex
CREATE INDEX "Warehouse_active_idx" ON "Warehouse"("active");
