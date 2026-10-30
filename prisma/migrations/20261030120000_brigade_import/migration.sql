-- AlterTable
ALTER TABLE "Brigade" ADD COLUMN     "baseCode" TEXT,
ADD COLUMN     "isEquipmentAccount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "terminatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BrigadeEvent" (
    "id" TEXT NOT NULL,
    "brigadeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "docId" TEXT,
    "action" TEXT NOT NULL,
    "diffJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrigadeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrigadeEvent_brigadeId_createdAt_idx" ON "BrigadeEvent"("brigadeId", "createdAt");

-- CreateIndex
CREATE INDEX "BrigadeEvent_docId_idx" ON "BrigadeEvent"("docId");

-- AddForeignKey
ALTER TABLE "BrigadeEvent" ADD CONSTRAINT "BrigadeEvent_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeEvent" ADD CONSTRAINT "BrigadeEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeEvent" ADD CONSTRAINT "BrigadeEvent_docId_fkey" FOREIGN KEY ("docId") REFERENCES "jaf_invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

