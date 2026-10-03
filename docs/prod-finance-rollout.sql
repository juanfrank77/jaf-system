-- Finance Arm A — production rollout SQL for IT
-- Safe to run any of the Section A queries at any time.
-- All statements are idempotent.
-- No DELETE, no DROP, no TRUNCATE.
-- Delete this file once the rollout is confirmed.

-- ============================================================
-- Section A — verification, read-only
-- ============================================================

-- expect: one row, name = 'ZARIEL SIERRA', code = '274' after Section B
SELECT id, name, code FROM "Brigade"
 WHERE code IS NULL OR name ILIKE 'ZARIEL%';

-- expect: 14
SELECT count(*) AS brigades FROM "Brigade";

-- expect: 0 rows
SELECT DISTINCT "contractorAccountCode"
  FROM "jaf_invoice"
 WHERE "contractorAccountCode" IS NOT NULL
   AND "contractorAccountCode" NOT IN (SELECT code FROM "ContractorAccount");

-- expect: 0 before seeding, 14 after Section D
SELECT count(*) AS accounts FROM "ContractorAccount";

-- expect: 14 rows after Section D, with '274 | ZARIEL SIERRA'
SELECT code, label, "brigadeId" FROM "ContractorAccount" ORDER BY code;

-- ============================================================
-- Section B — Zariel's row, run BEFORE seeding
-- ============================================================

UPDATE "Brigade" SET code = '274', name = 'ZARIEL SIERRA'
 WHERE code IS NULL AND name ILIKE 'ZARIEL%';

-- Re-run the Section A brigade query and confirm the row now reads
-- ZARIEL SIERRA | 274.

-- ============================================================
-- Section E — close out settled history
-- ============================================================

-- E1. Preview first — record the number. Do not proceed until it
--     matches what the client agreed.
SELECT id, "controlNumber", "releasedToFinanceAt"
  FROM "jaf_invoice"
 WHERE <CLIENT-AGREED PREDICATE FOR SETTLED HISTORY>
   AND "payrollRunId" IS NULL
   AND "payablesClosedAt" IS NULL;

-- E2. ONLY after the preview count is agreed and a backup exists:
UPDATE "jaf_invoice"
   SET "payablesClosedAt" = now(), "payablesClosedById" = <AN ADMIN USER ID>
 WHERE <CLIENT-AGREED PREDICATE FOR SETTLED HISTORY>
   AND "payrollRunId" IS NULL
   AND "payablesClosedAt" IS NULL;
