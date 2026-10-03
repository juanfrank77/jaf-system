# Finance Arm A — production rollout runbook for IT

Run this once, line by line, by an admin logged into the production server.
Nothing in this runbook touches production until Section C.

**Every statement is idempotent: re-running a completed section is safe.**
Sections A and the Section E preview are read-only.
No `DELETE`, no `DROP`, no `TRUNCATE`, no `prisma migrate reset` / `db push` /
`migrate dev` against prod.
Nothing is wired into `package.json` or CI — this is a manual, one-time
rollout, run by a human.

Delete both this runbook and `prod-finance-rollout.sql` once the rollout is
confirmed.

---

## Section A — verification, read-only, safe to run any time

```sql
SELECT id, name, code FROM "Brigade"
 WHERE code IS NULL OR name ILIKE 'ZARIEL%';
-- expect: one row, name = 'ZARIEL SIERRA', code = '274' after Section B

SELECT count(*) AS brigades FROM "Brigade";
-- expect: 14

SELECT DISTINCT "contractorAccountCode"
  FROM "jaf_invoice"
 WHERE "contractorAccountCode" IS NOT NULL
   AND "contractorAccountCode" NOT IN (SELECT code FROM "ContractorAccount");
-- expect: 0 rows

SELECT count(*) AS accounts FROM "ContractorAccount";
-- expect: 0 before seeding, 14 after Section D

SELECT code, label, "brigadeId" FROM "ContractorAccount" ORDER BY code;
-- expect: 14 rows after Section D, with '274 | ZARIEL SIERRA'
```

A `contractorAccountCode` set with no matching row is the only thing that
blocks a brigade from sweeping — everything else (no `ContractorAccount`,
a mismatched code, a deactivated account) is either invisible to Lissette or
handled by the `no new work` half of q&a 14.4.

---

## Section B — Zariel's row, before anything seeds

Run **before** `pnpm prisma db seed`.

```sql
UPDATE "Brigade" SET code = '274', name = 'ZARIEL SIERRA'
 WHERE code IS NULL AND name ILIKE 'ZARIEL%';
```

Idempotent and safe whether or not a seed already applied the code.
Jobs reference brigades by `id`, so renaming disturbs no history.

Re-run the Section A brigade query and confirm the row now reads
`ZARIEL SIERRA | 274`.

---

## Section C — deploy

Reference `docs/it-deployment-guide.md` §8: build first, stop the service
across migrate + start, `pnpm prisma migrate deploy`, start.

This deploy applies **three** migrations
(`20260927135328_add_supervisor_areas`,
 `20260928005451_warehouse_foundation`,
 `20260929140000_finance_billing_arm_a`).

`warehouse_foundation` renames `van_movement` to `stock_movement`, which is
why the build must happen before the stop.

---

## Section D — seed, required

`pnpm prisma db seed`

It is **not** optional: `ContractorAccount` rows come only from
`seedContractorAccounts` (`prisma/seed.ts:491`), and a brigade with no
account can never be swept.

Re-run the Section A queries and confirm:

- Brigade count is **still 14**, not 15 — no brigade was duplicated.
- `274 | ZARIEL SIERRA` now appears in `ContractorAccount`.

---

## Section E — close out settled history, before anyone generates a run

**This is the one step with no correct-by-construction SQL.** The sweep has
no date floor by design (q&a 15.1 / 15.4), and `/finance/payroll` is gated
on `FINANCE` / `ADMIN` — **not** on `ENABLE_COMPTROLLER` — so no feature
flag holds it back. Without this, the first Generate run freezes contractor
amounts onto every settled historical job and marks them payable in a single
action.

Require the §10 backup first, and stop and escalate if the preview count
differs from what the client agreed.

### E1. Preview first — do not proceed until it matches

```sql
SELECT id, "controlNumber", "releasedToFinanceAt"
  FROM "jaf_invoice"
 WHERE <CLIENT-AGREED PREDICATE FOR SETTLED HISTORY>
   AND "payrollRunId" IS NULL
   AND "payablesClosedAt" IS NULL;
```

Record the number. Do not proceed until it matches what the client agreed.

### E2. Only after the preview count is agreed and a backup exists

```sql
UPDATE "jaf_invoice"
   SET "payablesClosedAt" = now(), "payablesClosedById" = <AN ADMIN USER ID>
 WHERE <CLIENT-AGREED PREDICATE FOR SETTLED HISTORY>
   AND "payrollRunId" IS NULL
   AND "payablesClosedAt" IS NULL;
```

---

## Section F — first Generate run

Only after Sections A–E are confirmed green, and only by Lissette.

Note that `/finance/payroll` is **not** feature-flagged, so this happens the
moment the code is live.
