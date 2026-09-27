-- AlterTable
ALTER TABLE "User" ADD COLUMN     "supervisorAreas" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: give every existing SUPERVISOR the union of areas of the
-- brigades they currently own, so this migration doesn't silently narrow
-- anyone's access on deploy. This is a one-time snapshot, not a live
-- derivation — supervisorAreas is admin-managed from here on; a later edit
-- to Brigade.area/supervisorId no longer changes anyone's authorization.
UPDATE "User" u
SET "supervisorAreas" = sub.areas
FROM (
  SELECT b."supervisorId" AS user_id, array_agg(DISTINCT b."area") AS areas
  FROM "Brigade" b
  WHERE b."supervisorId" IS NOT NULL AND b."area" IS NOT NULL
  GROUP BY b."supervisorId"
) sub
WHERE u.id = sub.user_id AND u.role = 'SUPERVISOR';
