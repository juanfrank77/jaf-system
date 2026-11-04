-- AlterTable
ALTER TABLE "jaf_invoice" ADD COLUMN     "invoiceOriginal" JSONB,
ADD COLUMN     "invoiceVersion" INTEGER NOT NULL DEFAULT 1;
