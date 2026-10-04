# Finance Arm A — production rollout runbook for IT

Run this once, step by step, by an admin logged into the production server.
**Nothing touches production data until Step 3.** Steps 0 and 5 are read-only.

**Situation this runbook is written for:** the production database has only
ever held demo data from an earlier version of the seed — no real jobs, no
real users beyond the seeded/demo logins. Finance needs the brigade numbers
and contractor accounts replaced with the confirmed ones, **and the existing
logins must keep working** (they are how Finance and Admin are reached — the
current seed does not create Finance, Admin or Crew users).

This is a *targeted* cleanup: it removes only the old brigades and contractor
accounts. It does **not** drop the schema, reset migrations, or touch users,
the service catalog, warehouses, installers or stock. No `DROP`, no `TRUNCATE`,
no `prisma migrate reset` / `db push` / `migrate dev` against prod.

Delete this runbook and `prod-finance-rollout.sql` once the rollout is
confirmed. All statements are in `docs/prod-finance-rollout.sql`; run them with
`psql "$DATABASE_URL"` (source `.env` as the deploy guide does).

---

## Step 0 — preflight, read-only (before the deploy)

```sql
SELECT count(*) AS jobs FROM "jaf_invoice";
-- expect: 0. If it is not 0, STOP — the database holds jobs. Do not continue
-- with this runbook; use the appendix and escalate.

SELECT migration_name FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 3;
-- expect the newest to be 20260928005451_warehouse_foundation

SELECT email, role, active FROM "User" ORDER BY role, email;
-- expect: only seeded/demo accounts. Write this list down — it is who can log in.

SELECT name, code, active, cardinality("memberIds") AS crew FROM "Brigade" ORDER BY name;
-- expect: the 14 old brigades. Crew assignments (memberIds) on them are lost in Step 3.
```

---

## Step 1 — backup

Take the §10 backup from `docs/it-deployment-guide.md` before going further.

---

## Step 2 — deploy

`docs/it-deployment-guide.md` §8: pull, install, build first, stop the service
across `./scripts/apply-migrations.sh`, start.

Prod is already at `20260928005451_warehouse_foundation`. This deploy applies
**one** new migration, `20260929140000_finance_billing_arm_a`: purely additive
(two tables, eight nullable columns on `jaf_invoice`, indexes, foreign keys —
no renames, no drops). The script must report exactly one migration applied.
If prod lags behind, stop and escalate — never edit a migration.

---

## Step 3 — clear the old brigades and contractor accounts

Section 3 of the SQL file. It runs in one transaction and **ends in
`ROLLBACK`**: read the printed counts (0 jobs, 14 brigades, 0 accounts removed),
then change `ROLLBACK` to `COMMIT` and run it again. If a foreign key blocks the
delete, the whole transaction aborts and nothing is removed — stop and
escalate; do not work around it.

---

## Step 4 — seed

`pnpm prisma db seed`

Make sure `SEED_DEMO` is **not** set (no demo serials on prod), and that
`SEED_TEMP_PASSWORD` is in `.env` and the installer roster CSV is in place
(deploy guide §7). Existing accounts keep their passwords; only newly created
accounts get `SEED_TEMP_PASSWORD`.

This recreates the 15 brigades with the numbers printed on the paper
Production Journal (finance q&a 14.1) and creates a contractor account for each
brigade that has a number: **11 accounts** — 009, 011, 016, 019, 024, 025,
102, 124, 141, 176, 178. Four active brigades (Dino Castillo, Samuel González,
Carlos Rodríguez, IR Communication & Construction) have no confirmed number yet
and get no account; José A Ríos Rivera (141) is seeded inactive. When a missing
number is confirmed, enter it on the brigades screen — saving it creates the
account.

---

## Step 5 — verify, read-only

Section 5 of the SQL file. Expect 15 brigades, the 11 account codes above, no
job with an unmapped code, and the same user list you wrote down in Step 0.
Then log in as Finance (Lissette) and confirm `/finance/queue` and
`/finance/payroll` load.

Only after this is confirmed, and only by Lissette, generate the first run.
`/finance/payroll` is not feature-flagged: it is live the moment the code is.

---

## Appendix — only if the database holds real jobs

Not needed for the demo-only database. If Step 0 shows jobs, **stop** and
escalate: the cleanup in Step 3 must not run, the brigade numbers need an
in-place remap, and the first payroll run would sweep every released job ever.
The remap (A1) and close-out-of-history (A2) statements are in the appendix of
`docs/prod-finance-rollout.sql`.
