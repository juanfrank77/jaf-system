-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPERVISOR', 'CREW', 'WAREHOUSE', 'FINANCE', 'ADMIN');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('CREATED', 'PREPPED', 'SIGNED', 'FIELD_UPDATED', 'SUPERVISOR_APPROVED', 'CLARO_UPLOADED', 'LC_GENERATED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "location" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jaf_invoice" (
    "id" TEXT NOT NULL,
    "controlNumber" TEXT NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'CREATED',
    "jobType" TEXT NOT NULL,
    "jobAddressEstimated" TEXT NOT NULL,
    "estimatedMaterials" JSONB NOT NULL,
    "assignedCrewIds" TEXT[],
    "supervisorId" TEXT NOT NULL,
    "avisoNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preppedAt" TIMESTAMP(3),
    "preppedById" TEXT,
    "warehouseId" TEXT,
    "materialsTaken" JSONB,
    "releaseSignature" TEXT,
    "releasedById" TEXT,
    "releaseSignedAt" TIMESTAMP(3),
    "crewSignature" TEXT,
    "signedById" TEXT,
    "signedAt" TIMESTAMP(3),
    "overriddenById" TEXT,
    "overrideSignature" TEXT,
    "overrideAt" TIMESTAMP(3),
    "overrideReason" TEXT,
    "jobAddressActual" TEXT,
    "materialsUsed" JSONB,
    "fieldNotes" TEXT,
    "completedAt" TIMESTAMP(3),
    "supervisorApprovedAt" TIMESTAMP(3),
    "claroNotes" TEXT,
    "claroPdfPath" TEXT,
    "claroUploadedAt" TIMESTAMP(3),
    "lcRequestPdfPath" TEXT,
    "lcGeneratedAt" TIMESTAMP(3),
    "lcApprovedById" TEXT,
    "advanceReceivedAt" TIMESTAMP(3),
    "advanceAmount" DECIMAL(65,30),
    "finalPaymentReceivedAt" TIMESTAMP(3),
    "finalPaymentAmount" DECIMAL(65,30),
    "receivableClosedAt" TIMESTAMP(3),
    "receivableClosedById" TEXT,
    "warehouseReceiptPath" TEXT,

    CONSTRAINT "jaf_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditTrail" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "diffJson" JSONB NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditTrail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCode" (
    "id" TEXT NOT NULL,
    "claroCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'SR',
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "accountCode" TEXT,
    "subAct" TEXT,
    "dept" TEXT,
    "profitCenter" TEXT,
    "act" TEXT,
    "costCenterCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ServiceCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoLink" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "claroPONumber" TEXT NOT NULL,
    "acceptanceNumber" TEXT,
    "amount" DECIMAL(65,30),

    CONSTRAINT "PoLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "docId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VanRestockRequest" (
    "id" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "releaseSignature" TEXT,
    "releasedById" TEXT,
    "releaseSignedAt" TIMESTAMP(3),
    "receiverSignature" TEXT,
    "receiverSignedById" TEXT,
    "receiverSignedAt" TIMESTAMP(3),
    "overriddenById" TEXT,
    "overrideSignature" TEXT,
    "overrideAt" TIMESTAMP(3),
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VanRestockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentReceipt" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "receivedById" TEXT NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "items" JSONB NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsignmentReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "jaf_invoice_controlNumber_key" ON "jaf_invoice"("controlNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCode_claroCode_key" ON "ServiceCode"("claroCode");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_preppedById_fkey" FOREIGN KEY ("preppedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_lcApprovedById_fkey" FOREIGN KEY ("lcApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_receivableClosedById_fkey" FOREIGN KEY ("receivableClosedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTrail" ADD CONSTRAINT "AuditTrail_docId_fkey" FOREIGN KEY ("docId") REFERENCES "jaf_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditTrail" ADD CONSTRAINT "AuditTrail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_docId_fkey" FOREIGN KEY ("docId") REFERENCES "jaf_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PoLink" ADD CONSTRAINT "PoLink_docId_fkey" FOREIGN KEY ("docId") REFERENCES "jaf_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemSetting" ADD CONSTRAINT "SystemSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanRestockRequest" ADD CONSTRAINT "VanRestockRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanRestockRequest" ADD CONSTRAINT "VanRestockRequest_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanRestockRequest" ADD CONSTRAINT "VanRestockRequest_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanRestockRequest" ADD CONSTRAINT "VanRestockRequest_receiverSignedById_fkey" FOREIGN KEY ("receiverSignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VanRestockRequest" ADD CONSTRAINT "VanRestockRequest_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentReceipt" ADD CONSTRAINT "ConsignmentReceipt_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentReceipt" ADD CONSTRAINT "ConsignmentReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
