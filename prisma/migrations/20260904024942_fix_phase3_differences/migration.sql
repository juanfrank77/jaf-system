-- AlterTable
ALTER TABLE "ServiceCode" DROP COLUMN "PriceListRevision",
ADD COLUMN     "priceListRevision" TEXT,
ALTER COLUMN "unit" DROP NOT NULL;

