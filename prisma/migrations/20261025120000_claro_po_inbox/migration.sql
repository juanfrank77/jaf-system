-- CreateEnum
CREATE TYPE "ClaroPoStatus" AS ENUM ('PENDING', 'READING', 'READY', 'NEEDS_LOOK', 'BLOCKED', 'UNMATCHED', 'CONFIRMED');

-- CreateTable
CREATE TABLE "ClaroPo" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT,
    "poDate" TIMESTAMP(3),
    "termsDays" INTEGER,
    "statedPages" INTEGER,
    "filePages" INTEGER,
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "status" "ClaroPoStatus" NOT NULL DEFAULT 'PENDING',
    "docId" TEXT,
    "avisoCandidates" TEXT[],
    "lines" JSONB,
    "subtotal" DECIMAL(65,30),
    "ivu4" DECIMAL(65,30),
    "ivu115" DECIMAL(65,30),
    "total" DECIMAL(65,30),
    "checks" JSONB,
    "readError" TEXT,
    "entered" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readStartedAt" TIMESTAMP(3),
    "uploadedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,

    CONSTRAINT "ClaroPo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaroPo_status_receivedAt_idx" ON "ClaroPo"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "ClaroPo_poNumber_idx" ON "ClaroPo"("poNumber");

-- CreateIndex
CREATE INDEX "ClaroPo_docId_idx" ON "ClaroPo"("docId");

-- CreateIndex
CREATE INDEX "ClaroPo_fileHash_idx" ON "ClaroPo"("fileHash");

-- AddForeignKey
ALTER TABLE "ClaroPo" ADD CONSTRAINT "ClaroPo_docId_fkey" FOREIGN KEY ("docId") REFERENCES "jaf_invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaroPo" ADD CONSTRAINT "ClaroPo_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaroPo" ADD CONSTRAINT "ClaroPo_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

