-- CreateTable
CREATE TABLE "van_stock_level" (
    "id" TEXT NOT NULL,
    "vanId" TEXT NOT NULL,
    "serviceCodeId" TEXT NOT NULL,
    "parLevel" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "van_stock_level_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "van_stock_level_vanId_idx" ON "van_stock_level"("vanId");

-- CreateIndex
CREATE UNIQUE INDEX "van_stock_level_vanId_serviceCodeId_key" ON "van_stock_level"("vanId", "serviceCodeId");

-- AddForeignKey
ALTER TABLE "van_stock_level" ADD CONSTRAINT "van_stock_level_vanId_fkey" FOREIGN KEY ("vanId") REFERENCES "Van"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "van_stock_level" ADD CONSTRAINT "van_stock_level_serviceCodeId_fkey" FOREIGN KEY ("serviceCodeId") REFERENCES "ServiceCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
