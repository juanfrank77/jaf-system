-- AlterEnum
ALTER TYPE "ClaroPoStatus" ADD VALUE 'SUPERSEDED';

-- AlterTable
ALTER TABLE "ClaroPo" ADD COLUMN     "overrides" JSONB,
ADD COLUMN     "printed" JSONB,
ADD COLUMN     "supersededById" TEXT;

-- CreateIndex
CREATE INDEX "ClaroPo_supersededById_idx" ON "ClaroPo"("supersededById");

-- AddForeignKey
ALTER TABLE "ClaroPo" ADD CONSTRAINT "ClaroPo_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "ClaroPo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
