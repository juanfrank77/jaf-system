
-- AlterTable
ALTER TABLE "jaf_invoice" ADD COLUMN     "crewServiceLines" JSONB;

-- AlterTable
ALTER TABLE "pre_cert_sheet" ADD COLUMN     "brigadeCode" TEXT,
ADD COLUMN     "brigadeId" TEXT,
ADD COLUMN     "brigadeName" TEXT;

