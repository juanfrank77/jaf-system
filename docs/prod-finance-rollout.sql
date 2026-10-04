-- Finance Arm A — production rollout SQL for IT
-- Run with psql against the production database:  psql "$DATABASE_URL" -f ...
-- (or paste a section at a time). See docs/prod-finance-rollout.md.
-- Sections 0 and 5 are read-only. No DROP, no TRUNCATE, no schema reset.
-- Delete this file once the rollout is confirmed.

\set ON_ERROR_STOP on

-- ============================================================
-- Section 0 — preflight, read-only (BEFORE the deploy)
-- ============================================================

-- expect: 0. If not, STOP and escalate — do not run Section 3.
SELECT count(*) AS jobs FROM "jaf_invoice";

-- expect: newest is 20260928005451_warehouse_foundation
SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 3;

-- Write this list down: it is who can log in, and Section 5 must show the same.
SELECT email, role, active FROM "User" ORDER BY role, email;

-- expect: the 14 old brigades; crew (memberIds) on them is lost in Section 3.
SELECT name, code, active, cardinality("memberIds") AS crew FROM "Brigade" ORDER BY name;

-- ============================================================
-- Section 3 — clear the old brigades and contractor accounts
-- (AFTER the deploy, BEFORE the seed; needs a backup)
-- ============================================================

-- One transaction. It aborts as a whole if any foreign key blocks a delete
-- (e.g. a job still references a brigade) — then stop and escalate.
-- Read the printed counts, then change ROLLBACK to COMMIT and run it again.
BEGIN;
SELECT count(*) AS jobs_must_be_zero FROM "jaf_invoice";
DELETE FROM "ContractorAccount";   -- expect 0 rows (table is new)
DELETE FROM "Brigade";             -- expect 14 rows
ROLLBACK;

-- ============================================================
-- Section 5 — verify, read-only (AFTER `pnpm prisma db seed`)
-- ============================================================

-- expect: 15 (14 seeded + the inactive José A Ríos Rivera)
SELECT count(*) AS brigades FROM "Brigade";

-- expect: 009, 011, 016, 019, 024, 025, 102, 124, 141, 176, 178 (141 inactive)
SELECT code, label, active, "brigadeId" FROM "ContractorAccount" ORDER BY code;

-- expect: exactly 4 rows with no number: Dino Castillo, Samuel González,
-- Carlos Rodríguez, IR Communication & Construction
SELECT name, active FROM "Brigade" WHERE code IS NULL ORDER BY name;

-- expect: 0 rows
SELECT DISTINCT "contractorAccountCode"
  FROM "jaf_invoice"
 WHERE "contractorAccountCode" IS NOT NULL
   AND "contractorAccountCode" NOT IN (SELECT code FROM "ContractorAccount");

-- expect: the same list you wrote down in Section 0
SELECT email, role, active FROM "User" ORDER BY role, email;

-- ============================================================
-- APPENDIX — ONLY if Section 0 showed real jobs (otherwise skip entirely)
-- ============================================================

-- A1. Re-point open jobs at the new brigade numbers, AFTER seeding. A job
-- copies Brigade.code onto jaf_invoice.contractorAccountCode when the
-- sub-contractor signs, so jobs signed earlier carry the old code. By brigade,
-- not by code; settled history is untouched; safe to re-run.

-- Preview:
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

-- A2. Close out settled history BEFORE anyone generates a run: the sweep has
-- no date floor, so the first run would otherwise freeze and pay every
-- released job ever. Inputs must be agreed with the client first:
--   cutoff   - jobs released to Finance before this date are settled history
--   admin_id - an active ADMIN user id
\set cutoff '2026-01-01'
\set admin_id 'REPLACE-WITH-ADMIN-USER-ID'

SELECT count(*) AS would_close, min("releasedToFinanceAt"), max("releasedToFinanceAt")
  FROM "jaf_invoice"
 WHERE "releasedToFinanceAt" < :'cutoff'::timestamp
   AND "payrollRunId" IS NULL
   AND "payablesClosedAt" IS NULL;

-- Change ROLLBACK to COMMIT only after the count is agreed and a backup exists.
BEGIN;
UPDATE "jaf_invoice"
   SET "payablesClosedAt" = now(), "payablesClosedById" = :'admin_id'
 WHERE "releasedToFinanceAt" < :'cutoff'::timestamp
   AND "payrollRunId" IS NULL
   AND "payablesClosedAt" IS NULL;
ROLLBACK;
