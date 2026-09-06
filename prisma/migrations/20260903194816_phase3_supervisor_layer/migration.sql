-- CreateEnum
CREATE TYPE "CatalogKind" AS ENUM ('SERVICE', 'MATERIAL');

-- AlterTable
ALTER TABLE "Brigade" ADD COLUMN     "area" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "leadName" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "supervisorId" TEXT;

-- AlterTable
ALTER TABLE "ServiceCode" ADD COLUMN     "PriceListRevision" TEXT,
ADD COLUMN     "claroBasePrice" DECIMAL(65,30),
ADD COLUMN     "contractorFactor" DECIMAL(65,30),
ADD COLUMN     "contractorPrice" DECIMAL(65,30),
ADD COLUMN     "effectiveFrom" TIMESTAMP(3),
ADD COLUMN     "kind" "CatalogKind" NOT NULL DEFAULT 'MATERIAL',
ADD COLUMN     "upliftFactor" DECIMAL(65,30),
ALTER COLUMN "unit" DROP DEFAULT;

-- AlterTable
ALTER TABLE "jaf_invoice" ADD COLUMN     "avisoDocPath" TEXT,
ADD COLUMN     "avisoLineTotal" DECIMAL(65,30),
ADD COLUMN     "avisoLines" JSONB,
ADD COLUMN     "avisoMatchedAt" TIMESTAMP(3),
ADD COLUMN     "brigadeId" TEXT,
ADD COLUMN     "contractorAccountCode" TEXT,
ADD COLUMN     "installedServiceLines" JSONB,
ADD COLUMN     "jafInvoiceGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "jafInvoiceLineTotal" DECIMAL(65,30),
ADD COLUMN     "jafInvoiceLines" JSONB,
ADD COLUMN     "jobDescription" TEXT,
ADD COLUMN     "releasedToFinanceAt" TIMESTAMP(3),
ADD COLUMN     "releasedToFinanceById" TEXT,
ADD COLUMN     "serviceLines" JSONB;

-- CreateTable
CREATE TABLE "pre_cert_sheet" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "avisoNumber" TEXT,
    "certifiedAddress" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issuedOn" TIMESTAMP(3) NOT NULL,
    "lines" JSONB NOT NULL,
    "priceListRevision" TEXT,
    "total" DECIMAL(65,30) NOT NULL,
    "sigSupervisorUserId" TEXT,
    "sigSupervisorName" TEXT,
    "sigSupervisorImage" TEXT,
    "sigSupervisorAt" TIMESTAMP(3),
    "sigSubcontractorCode" TEXT,
    "sigSubcontractorName" TEXT,
    "sigSubcontractorImage" TEXT,
    "sigSubcontractorAt" TIMESTAMP(3),
    "sigClaroName" TEXT,
    "sigClaroImage" TEXT,
    "sigClaroScanPath" TEXT,
    "sigClaroAt" TIMESTAMP(3),
    "pdfPath" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,

    CONSTRAINT "pre_cert_sheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pre_cert_sheet_docId_supersededAt_idx" ON "pre_cert_sheet"("docId", "supersededAt");

-- CreateIndex
CREATE UNIQUE INDEX "pre_cert_sheet_docId_version_key" ON "pre_cert_sheet"("docId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Brigade_code_key" ON "Brigade"("code");

-- CreateIndex
CREATE INDEX "Brigade_supervisorId_idx" ON "Brigade"("supervisorId");

-- CreateIndex
CREATE INDEX "ServiceCode_kind_active_idx" ON "ServiceCode"("kind", "active");

-- CreateIndex
CREATE INDEX "jaf_invoice_brigadeId_idx" ON "jaf_invoice"("brigadeId");

-- CreateIndex
CREATE INDEX "jaf_invoice_releasedToFinanceAt_idx" ON "jaf_invoice"("releasedToFinanceAt");

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_releasedToFinanceById_fkey" FOREIGN KEY ("releasedToFinanceById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_cert_sheet" ADD CONSTRAINT "pre_cert_sheet_docId_fkey" FOREIGN KEY ("docId") REFERENCES "jaf_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brigade" ADD CONSTRAINT "Brigade_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_cert_sheet" ADD CONSTRAINT "pre_cert_sheet_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
