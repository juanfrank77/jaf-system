# Finance Arm A — production rollout runbook for IT

Run this once, line by line, by an admin logged into the production server.
Nothing in this runbook touches production until Section C.

**Re-running a completed section is safe** (Section E2 is guarded so a second
run changes nothing). Section A and the Section E1 preview are read-only.
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
-- expect: one row, name = 'ZARIEL SIERRA' after Section B

SELECT count(*) AS brigades FROM "Brigade";
-- expect: 14 before the seed, 15 after (it adds the inactive José A Ríos Rivera)

SELECT DISTINCT "contractorAccountCode"
  FROM "jaf_invoice"
 WHERE "contractorAccountCode" IS NOT NULL
   AND "contractorAccountCode" NOT IN (SELECT code FROM "ContractorAccount");
-- expect: 0 rows

SELECT count(*) AS accounts FROM "ContractorAccount";
-- expect: 0 before seeding, 11 after Section D

SELECT code, label, active, "brigadeId" FROM "ContractorAccount" ORDER BY code;
-- expect after Section D: 009, 011, 016, 019, 024, 025, 102, 124, 141, 176, 178
```

A `contractorAccountCode` set with no matching row is the only thing that
blocks a brigade from sweeping — everything else (no `ContractorAccount`,
a mismatched code, a deactivated account) is either invisible to Lissette or
handled by the `no new work` half of q&a 14.4.

---

## Section B — Zariel's row, before anything seeds

Run **before** `pnpm prisma db seed`.

```sql
UPDATE "Brigade" SET name = 'ZARIEL SIERRA'
 WHERE name ILIKE 'ZARIEL%' AND name <> 'ZARIEL SIERRA';
```

The seed matches brigades by name, so a leftover `ZARIEL GARAY` row would be
duplicated rather than updated; the seed then sets its number (178). Expect
`UPDATE 1` the first time and `UPDATE 0` after; more than 1 means stop and
escalate. Jobs reference brigades by `id`, so renaming disturbs no history.

Re-run the Section A brigade query and confirm the row now reads
`ZARIEL SIERRA`.

---

## Section C — deploy

Reference `docs/it-deployment-guide.md` §8: build first, stop the service
across migrate + start, `pnpm prisma migrate deploy`, start.

Prod is already at `20260928005451_warehouse_foundation` (the Supervisor and
Warehouse work). This deploy applies **one** new migration,
`20260929140000_finance_billing_arm_a` — purely additive (two tables, eight
nullable columns on `jaf_invoice`, indexes and foreign keys; no renames, no
drops).

Confirm that before deploying:

```sql
SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 3;
-- expect the newest to be 20260928005451_warehouse_foundation
```

`pnpm prisma migrate deploy` should then report exactly one migration applied.
If prod lags behind, stop and escalate — do not edit any migration.

---

## Section D — seed, required

`pnpm prisma db seed`

It is **not** optional: `ContractorAccount` rows come only from
`seedContractorAccounts` (called from `prisma/seed.ts`), and a brigade with no
account can never be swept. The seed is the same repeatable step the deploy
guide already uses (§7); make sure `SEED_DEMO` is **not** set, so no demo
serials are written to prod.

The seed now sets each brigade's number to the one printed on the paper
Production Journal (finance q&a 14.1) — it **replaces** the codes prod
currently has — and creates a `ContractorAccount` for each brigade that has a
number: 11 of the 15 brigades. Four active brigades (Dino Castillo, Samuel
González, Carlos Rodríguez, IR Communication & Construction) have no confirmed
number yet and are left without one; José A Ríos Rivera (141) is seeded
inactive because he has work on the journal but is not on the active roster.

Re-run the Section A queries and confirm:

- Brigade count is **15** (14 + José A Ríos Rivera) — no other brigade was
  duplicated.
- `ContractorAccount` holds exactly the 11 numbers listed in Section A.

---

## Section D2 — re-point open jobs at the new numbers

A job copies its brigade's number when the sub-contractor signs, so jobs signed
before the seed still carry the old number and would show **"account not
mapped"** on L1. Run Section D2 of `docs/prod-finance-rollout.sql`: it previews,
then re-points every job that is not yet in a run and not yet closed, by
brigade. Settled history is untouched, and it is safe to run again — run it
again whenever a missing brigade number is confirmed and entered on the
brigades screen (that screen creates the `ContractorAccount` itself).

Confirm in L1 that no job (other than those of the four brigades without a
number) shows "account not mapped".

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

Two inputs are needed, and the client must agree on both before you run
anything:

- the **cutoff date**: every job released to Finance before it is "settled
  history" (already paid outside the system);
- an **admin user id** to record as the closer:
  `SELECT id, email FROM "User" WHERE role = 'ADMIN' AND active;`

The statements are in `docs/prod-finance-rollout.sql` (Section E), run with
`psql`; set the two inputs at the top of that file before running it.

### E1. Preview first — do not proceed until it matches

Records the number of jobs that would be closed. Stop and escalate if it does
not match what the client agreed.

### E2. Only after the preview count is agreed and a backup exists

Runs in one transaction, prints the number of rows updated, and ends with
`ROLLBACK` — change it to `COMMIT` only once the count is confirmed.

---

## Section F — first Generate run

Only after Sections A–E are confirmed green, and only by Lissette.

Note that `/finance/payroll` is **not** feature-flagged, so this happens the
moment the code is live.
