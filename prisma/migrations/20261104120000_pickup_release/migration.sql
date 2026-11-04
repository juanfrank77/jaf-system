-- CreateTable
CREATE TABLE "pickup_release" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "releasedById" TEXT NOT NULL,
    "releasedByName" TEXT NOT NULL,
    "signedById" TEXT,
    "crewSignerName" TEXT NOT NULL,
    "crewSignerBrigadeId" TEXT,
    "crewSignerBrigadeName" TEXT,
    "crewSignerBrigadeCode" TEXT,
    "releaseSignature" TEXT NOT NULL,
    "crewSignature" TEXT NOT NULL,
    "materials" JSONB NOT NULL,
    "receiptPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickup_release_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pickup_release_docId_number_key" ON "pickup_release"("docId", "number");

-- AddForeignKey
ALTER TABLE "pickup_release" ADD CONSTRAINT "pickup_release_docId_fkey" FOREIGN KEY ("docId") REFERENCES "jaf_invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
