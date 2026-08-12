-- CreateIndex
CREATE INDEX "AuditTrail_docId_timestamp_idx" ON "AuditTrail"("docId", "timestamp");

-- CreateIndex
CREATE INDEX "Notification_userId_read_createdAt_idx" ON "Notification"("userId", "read", "createdAt");

-- CreateIndex
CREATE INDEX "User_role_active_idx" ON "User"("role", "active");

-- CreateIndex
CREATE INDEX "jaf_invoice_status_lcGeneratedAt_idx" ON "jaf_invoice"("status", "lcGeneratedAt");

-- CreateIndex
CREATE INDEX "jaf_invoice_createdAt_idx" ON "jaf_invoice"("createdAt");

-- CreateIndex
CREATE INDEX "jaf_invoice_assignedCrewIds_idx" ON "jaf_invoice" USING GIN ("assignedCrewIds" array_ops);
