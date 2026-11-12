-- AlterTable
ALTER TABLE "brigade_restock" ADD COLUMN     "crewSignature" TEXT,
ADD COLUMN     "crewSignerBrigadeId" TEXT,
ADD COLUMN     "crewSignerName" TEXT,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "releaseSignature" TEXT;

-- AlterTable
ALTER TABLE "brigade_restock_line" ADD COLUMN     "givenQty" INTEGER,
ADD COLUMN     "note" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "brigade_restock_number_key" ON "brigade_restock"("number");
