-- Finance Arm A — production rollout SQL for IT
-- Run with psql against the production database.
-- Section A is read-only and safe at any time. No DELETE, no DROP, no TRUNCATE.
-- Delete this file once the rollout is confirmed.

\set ON_ERROR_STOP on

-- ============================================================
-- Section A — verification, read-only
-- ============================================================

-- expect: prod's newest migration is 20260928005451_warehouse_foundation
SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 3;

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

-- Only touches a row that still has no code, so a re-run changes nothing.
-- expect: UPDATE 1 (the first time), UPDATE 0 afterwards. If it is ever more
-- than 1, stop and escalate.
UPDATE "Brigade" SET code = '274', name = 'ZARIEL SIERRA'
 WHERE code IS NULL AND name ILIKE 'ZARIEL%';

-- ============================================================
-- Section E — close out settled history, before anyone generates a run
-- ============================================================

-- Inputs: BOTH must be agreed with the client first.
--   cutoff   - jobs released to Finance before this date are settled history
--   admin_id - an active ADMIN user id (SELECT id, email FROM "User"
--              WHERE role = 'ADMIN' AND active;)
\set cutoff '2026-01-01'
\set admin_id 'REPLACE-WITH-ADMIN-USER-ID'

-- E1. Preview — record the number and compare it with what the client agreed.
SELECT count(*) AS would_close, min("releasedToFinanceAt"), max("releasedToFinanceAt")
  FROM "jaf_invoice"
 WHERE "releasedToFinanceAt" < :'cutoff'::timestamp
   AND "payrollRunId" IS NULL
   AND "payablesClosedAt" IS NULL;

-- E2. ONLY after the preview count is agreed and a backup exists.
-- Change ROLLBACK to COMMIT once the printed row count is confirmed.
BEGIN;
UPDATE "jaf_invoice"
   SET "payablesClosedAt" = now(), "payablesClosedById" = :'admin_id'
 WHERE "releasedToFinanceAt" < :'cutoff'::timestamp
   AND "payrollRunId" IS NULL
   AND "payablesClosedAt" IS NULL;
ROLLBACK;
