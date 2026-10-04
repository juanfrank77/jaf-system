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

-- expect: one row, name = 'ZARIEL SIERRA' after Section B (code 178 after the seed)
SELECT id, name, code FROM "Brigade"
 WHERE code IS NULL OR name ILIKE 'ZARIEL%';

-- expect: 14 before the seed, 15 after (the seed adds the inactive José A Ríos Rivera)
SELECT count(*) AS brigades FROM "Brigade";

-- expect: 0 rows
SELECT DISTINCT "contractorAccountCode"
  FROM "jaf_invoice"
 WHERE "contractorAccountCode" IS NOT NULL
   AND "contractorAccountCode" NOT IN (SELECT code FROM "ContractorAccount");

-- expect: 0 before seeding, 11 after Section D (the brigades with a confirmed number)
SELECT count(*) AS accounts FROM "ContractorAccount";

-- expect after Section D: 009, 011, 016, 019, 024, 025, 102, 124, 141, 176, 178
SELECT code, label, active, "brigadeId" FROM "ContractorAccount" ORDER BY code;

-- ============================================================
-- Section B — Zariel's row, run BEFORE seeding
-- ============================================================

-- The seed matches brigades by name, so a leftover "ZARIEL GARAY" row would be
-- duplicated instead of updated. Rename it first; the seed then sets code 178.
-- expect: UPDATE 1 (the first time), UPDATE 0 afterwards. If it is ever more
-- than 1, stop and escalate.
UPDATE "Brigade" SET name = 'ZARIEL SIERRA'
 WHERE name ILIKE 'ZARIEL%' AND name <> 'ZARIEL SIERRA';

-- ============================================================
-- Section D2 — re-point open jobs at the new brigade numbers, AFTER seeding
-- ============================================================

-- A job copies Brigade.code onto jaf_invoice.contractorAccountCode when the
-- sub-contractor signs. The seed replaces the old codes (e.g. 206) with the
-- journal numbers (e.g. 025), so jobs signed earlier still carry the old code
-- and would show as "account not mapped". This re-points every job that is not
-- yet in a run and not yet closed, by brigade (not by code), so it needs no
-- mapping table. Settled history is untouched. Safe to re-run — run it again
-- after a brigade's number is confirmed later.

-- Preview: how many jobs move, and from which code to which.
SELECT b.name, j."contractorAccountCode" AS signed_code, b.code AS new_code, count(*) AS jobs
  FROM "jaf_invoice" j
  JOIN "Brigade" b ON b.id = j."brigadeId"
 WHERE b.code IS NOT NULL
   AND j."contractorAccountCode" IS DISTINCT FROM b.code
   AND j."payrollRunId" IS NULL
   AND j."payablesClosedAt" IS NULL
 GROUP BY 1, 2, 3 ORDER BY 1;

-- Change ROLLBACK to COMMIT once the preview matches expectations.
BEGIN;
UPDATE "jaf_invoice" j
   SET "contractorAccountCode" = b.code
  FROM "Brigade" b
 WHERE b.id = j."brigadeId"
   AND b.code IS NOT NULL
   AND j."contractorAccountCode" IS DISTINCT FROM b.code
   AND j."payrollRunId" IS NULL
   AND j."payablesClosedAt" IS NULL;
ROLLBACK;

-- Jobs of brigades with no confirmed number yet (Dino Castillo, Samuel
-- González, Carlos Rodríguez, IR Communication & Construction) keep their old
-- code and show "account not mapped" on L1 until the number is entered on the
-- brigades screen and this section is run again.

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
