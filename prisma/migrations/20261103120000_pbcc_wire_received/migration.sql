-- AlterTable
ALTER TABLE "BankSchedule" ADD COLUMN     "wireAmount" DECIMAL(65,30),
ADD COLUMN     "wireReceivedAt" TIMESTAMP(3),
ADD COLUMN     "wireRecordedById" TEXT;

-- AddForeignKey
ALTER TABLE "BankSchedule" ADD CONSTRAINT "BankSchedule_wireRecordedById_fkey" FOREIGN KEY ("wireRecordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
