-- AlterTable
ALTER TABLE "EwitInvoice" ADD COLUMN     "shortAcceptedById" TEXT,
ADD COLUMN     "shortAcceptedReason" TEXT;

-- AddForeignKey
ALTER TABLE "EwitInvoice" ADD CONSTRAINT "EwitInvoice_shortAcceptedById_fkey" FOREIGN KEY ("shortAcceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
