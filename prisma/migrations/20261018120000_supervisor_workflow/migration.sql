-- CreateEnum
CREATE TYPE "PacketSendOutcome" AS ENUM ('SENT', 'FAILED', 'UNCONFIGURED', 'MANUAL');

-- AlterEnum
ALTER TYPE "PhotoTag" ADD VALUE 'DURING';

-- AlterTable
ALTER TABLE "jaf_invoice" ADD COLUMN     "blueprintPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "ciudad" TEXT,
ADD COLUMN     "claroSupervisorId" TEXT,
ADD COLUMN     "direccion1" TEXT,
ADD COLUMN     "direccion2" TEXT,
ADD COLUMN     "fieldMaterials" JSONB,
ADD COLUMN     "fieldStartedAt" TIMESTAMP(3),
ADD COLUMN     "grupoPlan" TEXT,
ADD COLUMN     "latitud" TEXT,
ADD COLUMN     "longitud" TEXT,
ADD COLUMN     "ordenNumber" TEXT,
ADD COLUMN     "pedido" TEXT,
ADD COLUMN     "sector" TEXT,
ADD COLUMN     "smr" TEXT,
ADD COLUMN     "tipo" TEXT,
ADD COLUMN     "tipoPlanta" TEXT,
ADD COLUMN     "titulo" TEXT;

-- CreateTable
CREATE TABLE "ClaroSupervisor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requiresPrefield" BOOLEAN NOT NULL DEFAULT false,
    "requiresBlueprint" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaroSupervisor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PacketSend" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentById" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "claroSupervisorId" TEXT,
    "outcome" "PacketSendOutcome" NOT NULL,
    "error" TEXT,

    CONSTRAINT "PacketSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PacketSend_docId_sentAt_idx" ON "PacketSend"("docId", "sentAt");

-- CreateIndex
CREATE INDEX "jaf_invoice_claroSupervisorId_idx" ON "jaf_invoice"("claroSupervisorId");

-- AddForeignKey
ALTER TABLE "jaf_invoice" ADD CONSTRAINT "jaf_invoice_claroSupervisorId_fkey" FOREIGN KEY ("claroSupervisorId") REFERENCES "ClaroSupervisor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PacketSend" ADD CONSTRAINT "PacketSend_docId_fkey" FOREIGN KEY ("docId") REFERENCES "jaf_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PacketSend" ADD CONSTRAINT "PacketSend_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PacketSend" ADD CONSTRAINT "PacketSend_claroSupervisorId_fkey" FOREIGN KEY ("claroSupervisorId") REFERENCES "ClaroSupervisor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

