-- AlterTable
ALTER TABLE "BankSchedule" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT;

-- AddForeignKey
ALTER TABLE "BankSchedule" ADD CONSTRAINT "BankSchedule_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every schedule built before the PBCC batch was complete when it was built:
-- it counts as closed, so it is never mistaken for the open batch.
UPDATE "BankSchedule" SET "closedAt" = "generatedAt", "closedById" = "generatedById" WHERE "closedAt" IS NULL;
