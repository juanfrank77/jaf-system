-- AlterTable
ALTER TABLE "PayrollRunAccount" ADD COLUMN     "askAt" TIMESTAMP(3),
ADD COLUMN     "askById" TEXT,
ADD COLUMN     "askNote" TEXT,
ADD COLUMN     "heldAt" TIMESTAMP(3),
ADD COLUMN     "heldById" TEXT,
ADD COLUMN     "holdReason" TEXT;
