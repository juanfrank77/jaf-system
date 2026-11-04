-- AlterTable
ALTER TABLE "jaf_invoice" ADD COLUMN     "avisoDiscrepancy" JSONB,
ADD COLUMN     "avisoHistory" JSONB,
ADD COLUMN     "materialsFromWarehouse" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "materialsReason" TEXT,
ADD COLUMN     "packetStale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prefieldNeeded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prefieldPdfPath" TEXT;

-- Existing jobs take the Claro supervisor's prefield tag value at migration time.
UPDATE "jaf_invoice" j SET "prefieldNeeded" = c."requiresPrefield" FROM "ClaroSupervisor" c WHERE j."claroSupervisorId" = c.id;
