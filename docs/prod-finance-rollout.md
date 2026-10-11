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

SELECT email FROM "User" WHERE email LIKE '%@jafcomm.local';
-- expect: 4 rows, the old maintenance supervisors. This deploy replaces them
-- with @jafcom.net addresses and Step 5b deletes the old ones. Record them.

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
(three tables — `ContractorAccount`, `PayrollRun` and `PayrollRunAccount`, the
comptroller's per-account Paid tick — eight nullable columns on `jaf_invoice`,
indexes, foreign keys; no renames, no drops). The script must report exactly one migration applied.
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

Two things to know about what this seed run creates:

- **The four maintenance supervisors are new users, not updated ones.** The seed
  upserts a user by email, and the addresses changed from `@jafcomm.local` to
  `@jafcom.net`, so `eocasio@`/`charlie@`/`irivera@`/`rramos@` are created
  alongside the old four rather than replacing them. `irivera@jafcom.net` is
  unconfirmed — it does not match the supervisor it belongs to and our own admin
  mockup flagged it as possibly the departed installer clerk's. Step 5b removes
  the old rows. Because `supervisorAreas` is only set on create, these new users
  get their areas from the seed, which is the point of checking them in Step 5.
- **Four warehouse logins are on constructed addresses.** Frank Ramos, Gilberto
  Ayala, Alfredo Medina and Catherine García have no email in any client
  document; only Orlando's `oguzman@jafcom.net` is confirmed. They are seeded
  anyway so the warehouse screens have staff, and Step 5 lists them so they can
  be corrected before go-live. Note that `active = false` does **not** block
  sign-in — `requireRole` never reads `user.active`.

---

## Step 5 — verify, read-only

Section 5 of the SQL file. Expect 15 brigades, the 11 account codes above, no
job with an unmapped code, 4 supervisors on `@jafcom.net` with the roster's
areas, and the 4 unverified warehouse logins listed for correction. Then log in
as Finance (Lissette) and confirm the Arm A screens load: Packets in
(`/finance/queue`), LC request (`/finance/lc-requests`), LC funded
(`/finance/lc-funded`), Lists to Carmen (`/finance/payroll`) and Carmen's payment
(`/finance/awaiting-carmen`). Awaiting PO and Awaiting Ariba (Arm B) are
placeholders in the sidebar.

---

## Step 5a — create the comptroller login

The seed creates **no** COMPTROLLER user. Carmen's login has to be created by
an Admin on the `/admin/users` screen (role *Comptroller*) before the first
payroll run is generated, or nobody can tick accounts paid. Then log in as her
and confirm:

- she lands on `/comptroller` (the runs list) straight after login;
- `/finance/receivables` is refused — receivables is Finance/Admin only.

The comptroller role is always on. `ENABLE_COMPTROLLER` no longer exists; if it
is still in the server's `.env` it is ignored and can be deleted.

---

## Step 5b — delete the replaced `@jafcomm.local` logins

Section 5b of the SQL file, with `ROLLBACK` first. Without this, four extra
working logins survive the deploy on a domain that can never receive a password
reset. A `Doc` row still pointing at one of them has a required `supervisorId`
and will block the delete — if the transaction aborts, stop and escalate.

Only after this is confirmed, and only by Lissette, generate the first run.
Lists to Carmen (`/finance/payroll`) is not feature-flagged: it is live the moment the code is.
The Lists to Carmen screen only offers bank-funded packets: funding must be
recorded first on LC funded (`/finance/lc-funded`). Sent-but-unfunded packets
are held out of every list the UI creates. A run creates one row per contractor
account; the comptroller ticks each account paid at `/comptroller`.

`PAYROLL_FALLBACK_ENABLED` (default on) lets Finance confirm an account from the
paper journal while both systems run side by side. Set it to `false` in `.env`
at go-live so only the comptroller can tick.

---

## Appendix — only if the database holds real jobs

Not needed for the demo-only database. If Step 0 shows jobs, **stop** and
escalate: the cleanup in Step 3 must not run, the brigade numbers need an
in-place remap, and the first payroll run would sweep every released job ever.
The remap (A1) and close-out-of-history (A2) statements are in the appendix of
`docs/prod-finance-rollout.sql`.
