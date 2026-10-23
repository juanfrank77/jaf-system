-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentById" TEXT;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every run made before requests had a draft state was visible to Carmen the
-- moment it was generated: it counts as sent then.
UPDATE "PayrollRun" SET "sentAt" = "generatedAt", "sentById" = "generatedById" WHERE "sentAt" IS NULL;
