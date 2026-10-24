-- A PBCC batch is numbered when it is closed, not when an empty one is opened,
-- so sent batches run 1, 2, 3 with no gaps. Open batches have no number yet.
ALTER TABLE "BankSchedule" ALTER COLUMN "number" DROP NOT NULL;
ALTER TABLE "BankSchedule" ALTER COLUMN "number" DROP DEFAULT;
DROP SEQUENCE IF EXISTS "BankSchedule_number_seq";
UPDATE "BankSchedule" SET "number" = NULL WHERE "closedAt" IS NULL;
