# JAF Operations — On-Premise Setup Guide (Pilot / Quick Win)

**Purpose of this phase:** get the app running on a server inside the client's network so a small group of real users (supervisor, warehouse, crew, finance, admin) can use it day-to-day and we can see how it holds up before committing to a bigger rollout.

This is not a managed cloud deployment — there is no Vercel/AWS/Neon involved in production. Everything (app process + database + uploaded files) runs on hardware the client controls.

---

## 1. What this application is

A single Node.js web application (server-rendered, built with React Router 7) backed by a PostgreSQL database. It tracks maintenance job documents ("JAF Invoices") through a workflow: supervisor intake → warehouse pickup (dual signature) → crew field update → supervisor review/Claro submission → finance LC request → receivables tracking.

It also works as an installable PWA (Progressive Web App) — crew members can add it to their phone's home screen and the field-update screen keeps working with spotty connectivity, syncing once back online.

There are no third-party SaaS dependencies at runtime. The only outbound network need is during the initial build (to download npm packages), unless you do an offline/air-gapped build elsewhere and copy the result over.

---

## 2. Server requirements

| Item | Requirement | Notes |
|---|---|---|
| OS | Linux (any modern distro — Ubuntu Server 22.04/24.04 or Debian 12 recommended) | App also runs fine on Windows Server if that's the standard here, but the instructions below assume Linux |
| Node.js | **v24.3.0 or newer** | Pinned in `package.json` engines. Older Node will not work. |
| pnpm | **v10.12.4 or newer** | This project uses pnpm, not npm. Install via `corepack enable` (ships with Node) or `npm install -g pnpm` |
| PostgreSQL | v14+ recommended | Can run on the same server or a separate DB server reachable over the network |
| CPU / RAM | 2 vCPU / 4 GB RAM is plenty for a pilot with a handful of concurrent users | Scale up only if/when adopted more broadly |
| Disk | Minimum 10 GB free, growing over time | Job photos, signed PDFs, and signature images accumulate here — see Section 5 |
| Network | HTTPS reachable from crew's phones/tablets and office PCs on the local network (or VPN) | See Section 6 — HTTPS is **required**, not optional |

---

## 3. Software to install on the server

1. **Node.js 24+**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
   sudo apt-get install -y nodejs
   node -v   # confirm v24.x
   ```
2. **pnpm**
   ```bash
   corepack enable
   corepack prepare pnpm@latest --activate
   pnpm -v   # confirm v10.x+
   ```
3. **PostgreSQL** (skip if using an existing DB server)
   ```bash
   sudo apt-get install -y postgresql
   sudo -u postgres createuser jaf_app --pwprompt
   sudo -u postgres createdb jaf_operations -O jaf_app
   ```
4. **A process manager** so the app restarts automatically on crash or server reboot. Either works:
   - `systemd` service (recommended on Linux servers — see Section 9), or
   - `pm2` (`npm install -g pm2`)
5. **A reverse proxy with TLS** — `nginx` or `caddy`. Caddy is the simplest if there's an internal CA or you're fine with a self-signed/internal cert. See Section 6.

---

## 4. Getting the code onto the server

We (White Elephants dev team) will hand off the code as either:
- a git repository the IT admin clones, or
- a zip/tarball of the project.

There is **no committed lockfile** in this repo (`pnpm-lock.yaml` is intentionally gitignored at this stage) — we can include the lockfile alongside the code or you can run `pnpm install` fresh. Confirm with us which you prefer before deploying, so the installed package versions match what we tested.

Once you get the code either cloning with the repository or unzipping the tarball.

```bash
cd jaf-operations
pnpm install
```

---

## 5. Configuration (environment variables)

Create a `.env` file in the project root (`/opt/jaf-operations/.env`). This file holds secrets and must **not** be committed to git or shared outside the team.

| Variable | Example | What it's for |
|---|---|---|
| `DATABASE_URL` | `postgresql://jaf_app:PASSWORD@localhost:5432/jaf_operations` | Connection string to PostgreSQL |
| `BETTER_AUTH_SECRET` | (random 32+ char string) | Signs session cookies. Generate with `openssl rand -base64 32`. **Keep this secret and never reuse it across environments.** |
| `BETTER_AUTH_URL` | `https://jaf.internal.client-domain.com` | The public HTTPS URL users will hit. Must match exactly (scheme + host), or login/sessions will break. |
| `UPLOAD_DIR` | `/var/lib/jaf-operations/uploads` | Where job photos, signature images, and generated PDFs are stored. **See note below.** |
| `ENABLE_VARIANCE` | `false` | Unset or `false` to hide the supervisor Material Variance page (`/supervisor/variance`, 404) and its nav item. Set `true` once the page reconciles with the warehouse count. |
| `PAYROLL_FALLBACK_ENABLED` | `true` | On unless set to `false`. While on, Finance may confirm a payroll account from the paper journal (tagged *from paper*) alongside the comptroller's per-account tick. Set `false` at go-live so only the comptroller can tick. |

**Connection-string gotcha — `DATABASE_URL`:** Prisma parses this URL strictly. If the database password (or username) contains any of these characters — `@  /  ?  #  %  &  +  =` or a space — they **must be percent-encoded**, or Prisma throws `P1013: invalid port number in database URL`. The port itself is fine; the special characters truncate the URL before `:port`, so Prisma reads an empty/non-numeric port. Encode them as: `@`→`%40`, `#`→`%23`, `?`→`%3F`, `/`→`%2F`, `%`→`%25`, `&`→`%26`, `+`→`%2B`, `=`→`%3D`, space→`%20`.

To fix an existing `.env` automatically (secret-safe — it re-encodes in place and never prints the password, and backs up to `.env.bak` first), run from the project root:

```bash
node scripts/fix-db-url.mjs
```

Also: for a **local** Postgres install, use `sslmode=disable` (a stock server usually has SSL off). `sslmode=require` is for managed hosts like Neon and will fail to connect against a default local server.

**Important — `UPLOAD_DIR`:** if this variable isn't set, the app defaults to `/tmp/jaf/uploads`, which most Linux systems clear on reboot. That would silently delete photos, signatures, and audit PDFs. Set `UPLOAD_DIR` explicitly to a real persistent path (e.g. `/var/lib/jaf-operations/uploads`), create that directory, and make sure the user running the app can write to it:
```bash
sudo mkdir -p /var/lib/jaf-operations/uploads
sudo chown -R <app-user>:<app-user> /var/lib/jaf-operations/uploads
```

### Outbound email for the Claro packet (SMTP)

Step 5 of the supervisor workflow ("Send to Claro supervisor") emails the packet PDF, plus any blueprint files, to the Claro supervisor's address in the directory. The app sends it over SMTP using the mail account JAF's IT creates for it:

| Variable | Example | What it's for |
|---|---|---|
| `SMTP_HOST` | `mail.client-domain.com` | The SMTP server |
| `SMTP_PORT` | `587` | `465` uses implicit TLS; any other port (normally `587`) upgrades with STARTTLS |
| `SMTP_USER` | `packets@client-domain.com` | The mail account's login |
| `SMTP_PASSWORD` | (the account's password) | The mail account's password |
| `SMTP_FROM` | `IMS <packets@client-domain.com>` | The sender shown on the email |

- **All five are required, `SMTP_USER` and `SMTP_PASSWORD` included.** The app always logs in to the SMTP server: an unauthenticated relay (an open port 25 relay with no login) is **not supported**.
- **If any of them is missing**, nothing is sent. Each attempt is recorded in the job's send history as *Email not set up* (`UNCONFIGURED`), the screen says so, and the supervisor can download the packet, send it themselves and press **Mark as sent manually**. This is how the demo works without a mail server, and it keeps the workflow moving until the account exists.
- **If the server refuses or cannot be reached**, the attempt is recorded as *Failed* with the server's error message, the job does **not** advance, and the supervisor can try again (or use Mark as sent manually).
- **Credentials are never logged.** The password is stripped from any stored error message, and neither credentials nor email bodies are written to the app logs or the send history.
- Internal notification email (`email.server.ts`) is separate, best effort, and does not use these settings.

**How to test it:** after setting the five variables, restart the app (`sudo systemctl restart jaf-operations`). As an admin, add (or edit) a Claro supervisor on **Admin → Claro supervisors** with an email address you can read. Take a test job to Step 5 (signed off, that Claro supervisor chosen) and press **Send to Claro supervisor**. The send history under the button should show *Sent*, and the email should arrive with the packet PDF attached. *Failed* shows the server's error (wrong port, TLS, login, or a firewall blocking outbound SMTP); *Email not set up* means one of the five variables is missing or `SMTP_PORT` is not a number. Cancel the test job afterwards.

---

## 6. HTTPS is required, not optional

Two features in this app stop working over plain HTTP:
- **PWA / offline mode** for the installer completion queue — browsers only register service workers over HTTPS (or `localhost`).
- **Session cookies** — better-auth issues secure cookies that browsers will reject over plain HTTP outside of `localhost`.

You don't need a public CA-signed certificate for a pilot — an internal CA cert or even a self-signed cert trusted on the pilot devices is enough, as long as every device accessing the app trusts it. Put `nginx` or `caddy` in front of the Node app as a TLS-terminating reverse proxy. Example with Caddy (simplest option):

```
# /etc/caddy/Caddyfile
jaf.internal.client-domain.com {
    reverse_proxy localhost:3000
}
```

The app itself doesn't open a configurable port out of the box — `pnpm start` runs `react-router-serve` on port 3000 by default. Point the reverse proxy at `localhost:3000`.

---

## 7. Database migration, seeding, and first build

This migration drops four legacy tables (`ConsignmentReceipt`, `VanRestockRequest`, `install_log`, `van_inventory_transaction`) and `Van.standardStockLevels`, with no archive or backfill — verified empty against this production database before the migration was written. If you are running this against a *different* database (a restored backup, a staging instance, anything that isn't the verified production database), confirm these are still empty first:

```bash
# sources .env the same way scripts/apply-migrations.sh does, so this
# provably checks the same database migrate deploy is about to touch —
# a quoted DATABASE_URL (as shipped in .env.example) breaks a naive
# grep/cut extraction, and this avoids putting the password in argv.
set -a; source .env; set +a
psql "$DATABASE_URL" \
  -c 'SELECT count(*) FROM "ConsignmentReceipt"' \
  -c 'SELECT count(*) FROM "VanRestockRequest"' \
  -c 'SELECT count(*) FROM "install_log"' \
  -c 'SELECT count(*) FROM "van_inventory_transaction"' \
  -c 'SELECT count(*) FROM "Van" WHERE "standardStockLevels" IS NOT NULL'
```

All five counts must be 0. If any is non-zero, stop — that data is unrecoverable once `migrate deploy` runs below.

### The finance migration is additive, but it has one operational precondition

Unlike the migration above, the finance ("Arm A") migration does not drop anything. It adds `payrollRunId`, `payablesClosedAt`, `contractorAccountId`,
`contractorAccount`, `grossPayable`, `retentionAmount`, `netPayable` and
`contractorShareLines` to `jaf_invoice`, and creates the `PayrollRun` and
`ContractorAccount` tables. It does **not** add `paidAchRef` to `PayrollRun`. 
It also does not backfill anything — every pre-existing job row comes out of  it with `payrollRunId`, `payablesClosedAt`, `contractorAccountId` and
`contractorAccount` as `NULL`.


That is fine for the schema, but it has a consequence you need to act on before anyone uses the payroll screen. The payroll sweep has **no date floor**: "Generate run" takes every job that was released to finance, isn't closed, and isn't already in a run — with no lower bound on *when* it was released. On a database with real history that is the whole released backlog, not just the jobs that are genuinely outstanding.

So on the first run after this update, jobs that were released to finance years ago and were settled by hand in the meantime would be swept too: their
contractor amounts get frozen onto the row, they get a `payrollRunId`, they appear on the run detail screen, and they can then be confirmed as paid in a
single action.

**Decide what to do with the historical backlog before anyone clicks
"Generate run".** To see the size of it (read-only, safe to run whenever):

```bash
set -a; source .env; set +a
psql "$DATABASE_URL" -c "
  SELECT count(*) AS arm_a_open,
         min(\"releasedToFinanceAt\") AS oldest_released,
         max(\"releasedToFinanceAt\") AS newest_released
  FROM \"jaf_invoice\"
  WHERE \"status\" NOT IN ('LC_REQUEST_GENERATED', 'CANCELLED')
    AND \"releasedToFinanceAt\" IS NOT NULL
    AND \"payablesClosedAt\" IS NULL
    AND \"payrollRunId\" IS NULL;"
```

That count slightly over-estimates: the sweep also skips jobs carrying a `PBCC_ADVANCE` payment record. It is close enough to decide with.

Until that is done: deploy as normal, but don't generate a run.

### Pre/post row counts for the warehouse rename

The `20260928005451_warehouse_foundation` migration **renames** `van_movement` to `stock_movement` and backfills `kind` (`serial IS NULL` → `BULK`). It is data-preserving by construction, but it is a rename of a production ledger, so take a backup first (§10) and record these counts before you start:

```bash
set -a; source .env; set +a

# BEFORE
psql "$DATABASE_URL" \
  -c 'SELECT count(*) AS total FROM "van_movement"' \
  -c 'SELECT count(*) AS serial_null FROM "van_movement" WHERE "serial" IS NULL' \
  -c 'SELECT count(*) AS null_van FROM "van_movement" WHERE "vanId" IS NULL'   # expect 0
```

Write the numbers down. After `migrate deploy` (§8 step 4), run:

```bash
# AFTER
psql "$DATABASE_URL" \
  -c 'SELECT count(*) AS total FROM "stock_movement"' \
  -c 'SELECT count(*) AS null_van FROM "stock_movement" WHERE "vanId" IS NULL' \
  -c 'SELECT count(*) AS bulk FROM "stock_movement" WHERE "kind" = '"'"'BULK'"'"''
```

- `total` must equal the "before" `total`. A smaller number means rows were lost in the rename — stop and restore from backup.
- `null_van` must be 0. The migration adds a `CHECK` (`stock_movement_location_ck`) requiring exactly one of `vanId` / `warehouseId` per row, so a non-zero value would have blocked the migration outright; running the query confirms it.
- `bulk` must equal the "before" `serial_null`. That is the direct check on the migration's backfill step: every accessory (non-serialized) row becomes `BULK`, every serialized row stays `SERIAL`.

Add `SEED_TEMP_PASSWORD` to `.env` (do not pass it inline on the command line — it would persist in shell history and be readable via `ps` for the life of the process):

```bash
# .env
SEED_TEMP_PASSWORD=<choose a password here>
```

Then, from the project root:

```bash
pnpm prisma migrate deploy    # creates all tables
pnpm prisma db seed           # creates users, brigades, warehouses, installers, service codes
pnpm run build                # production build
pnpm run start                # starts the app on port 3000
```

**`SEED_TEMP_PASSWORD` is required** — the seed script refuses to run without it. There is no built-in default password; whatever you set here becomes the shared temporary password for every account the seed *creates*. **This only applies the first time an account is seeded** — re-running `pnpm prisma db seed` (to pick up new service codes, a growing roster, etc.) never touches the password of an account that already exists. That is deliberate: `pnpm prisma db seed` is a routine, repeatable deploy step (see the checklist in §12), and if it reset passwords on every run it would silently undo any admin-issued per-account reset (`/admin/users`) or a user's own password change the moment someone reran seeding for an unrelated reason.

**The installer roster CSV is not in version control** (it holds real names, employee/TOA numbers, and personal emails). Place it at `docs/JAF_Installer_Roster_seed.csv` (or point `INSTALLER_ROSTER_CSV_PATH` at wherever you keep it) before running the seed — it's gitignored, so `git pull` won't bring it over; transfer it out-of-band. The seed now fails fast if this file is missing, before any other account is written.

**Move every real account off this shared password before staff start touching the system.** A shared temporary password is meant to get the pilot running, not to be the permanent credential for real users. Re-running the seed does **not** change it for existing accounts (see above), so the only way to rotate it is the admin "Reset password" action at `/admin/users` for each account, or having each user set their own password once logged in. Do this once, before go-live.

**This is not a one-time concern.** Every account a seed run *creates* — including a new installer added to the roster CSV months after go-live — starts on `SEED_TEMP_PASSWORD`, same as the original batch. There is no automatic prompt or forced-reset flag for this. Whoever runs the seed for a roster addition is responsible for following up with the same admin reset (or self-service change) for that new account before handing over credentials.

---

## 8. Updating an existing deployment

Once the app is live, most future changes are updates to this same install, not a fresh setup — sections 3–5 don't need to be repeated. This is the routine sequence:

1. **Get the new code.**
   ```bash
   cd /opt/jaf-operations   # or wherever this deployment lives
   git pull origin master   # or however code is handed off for this deployment
   ```

2. **Install dependencies** (a given change may add new packages):
   ```bash
   pnpm install
   ```

3. **Build** — before migrating, not after:
   ```bash
   pnpm run build
   ```

4. **Stop the service, apply pending migrations, start it again.** Always use the script, never `prisma migrate deploy` by hand — it also regenerates the Prisma client, which is gitignored and won't otherwise match the newly-pulled schema:
   ```bash
   sudo systemctl stop jaf-operations
   ./scripts/apply-migrations.sh
   sudo systemctl start jaf-operations
   sudo systemctl status jaf-operations   # confirm it came back up clean
   ```
   `migrate deploy` is idempotent and forward-only: it only runs migrations `_prisma_migrations` doesn't already record, and never rolls back. Before running it, check whether the change notes for this update call out anything destructive (a dropped table or column) — if a migration is provably dropping already-empty schema, no extra care is needed; if it might affect real data, verify row counts against this database first, the same way `installer_v3`'s original migration was verified (§7).


   One migration is additive rather than destructive, but still needs a decision from us before the app is used: the finance migration backfills nothing, so the first payroll run afterwards would sweep the entire historical released backlog, not just outstanding work. See **§7, "The finance migration is additive, but it has one operational precondition"** — resolve it before anyone clicks "Generate run". The read-only backlog-count query, the close-out SQL, and the full step sequence are in `docs/prod-finance-rollout.md` (with `docs/prod-finance-rollout.sql` for review) — both files are deleted once the rollout is confirmed.

5. **Rebuild and restart:**
   ```bash
   pnpm run build
   sudo systemctl restart jaf-operations
   sudo systemctl status jaf-operations   # confirm it came back up clean
   ```
   **Why build first, and why the service is down across the migrate:** a schema change can land under a binary that doesn't expect it, so build the new binary first and keep the service stopped while the migration runs. For the Finance update the migration is a single additive one (`finance_billing_arm_a`: new tables, nullable columns, indexes, foreign keys — no renames and no drops; the earlier `van_movement` → `stock_movement` rename shipped with the Warehouse update and is already applied), so the stop window is seconds. Keep the stop/start sequence anyway: it is the same procedure every update uses.

6. **Re-seed only if there's new seed data to pick up** (a roster addition, new service codes) — it's not a required step for every update. `pnpm prisma db seed` only sets `SEED_TEMP_PASSWORD` on accounts it *creates*; it never touches an existing account's credential (§7).

7. **Spot-check the affected screens** after restart, in both languages if the update touched anything user-facing — switch the language toggle to confirm nothing regressed to English-only or a raw translation key.

If `git pull` isn't how code reaches this server (e.g. a zip/tarball hand-off, per §4), swap step 1 for however that hand-off works — everything from step 2 onward is the same either way.

---

## 9. Keeping it running (process management)

Don't run `pnpm run start` in a terminal session and walk away — it'll die when the SSH session ends. Use a systemd unit so it restarts on crash and on server reboot:

```ini
# /etc/systemd/system/jaf-operations.service
[Unit]
Description=JAF Operations
After=network.target postgresql.service

[Service]
Type=simple
User=<app-user>
WorkingDirectory=/opt/jaf-operations
EnvironmentFile=/opt/jaf-operations/.env
ExecStart=/usr/bin/pnpm run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jaf-operations
sudo systemctl status jaf-operations
```

---

## 10. Backups

Two things need to be backed up regularly — losing either loses real client work:

1. **The PostgreSQL database** (all job records, statuses, audit trail):
   ```bash
   pg_dump jaf_operations > jaf_operations_$(date +%F).sql
   ```
2. **The uploads directory** (`UPLOAD_DIR` from Section 5) — photos, signature images, generated PDFs. These are plain files on disk, not in the database, so a database backup alone is not enough.

A daily cron job covering both, with offsite/secondary copy, is the minimum for a pilot. We're happy to help script this once the server is up.

---

## 11. Things to flag back to us before going live with real users

- There is no Dockerfile — this is a plain Node deployment, not a containerized one. If a future phase wants containers, we'll build that properly.
- No lockfile is currently committed to the repo — confirm with us whether we're handing one off alongside the code so versions match what we tested.
- The app runs in production mode automatically when started with `pnpm run start` (`react-router-serve` sets `NODE_ENV=production`); no extra environment variable is needed for that.

---

## 12. Quick sanity checklist

- [ ] Node 24+, pnpm 10+, PostgreSQL installed
- [ ] `.env` created with real `DATABASE_URL`, a freshly generated `BETTER_AUTH_SECRET`, and the correct `BETTER_AUTH_URL`
- [ ] `UPLOAD_DIR` points to a persistent directory, not `/tmp`, and is writable by the app user
- [ ] HTTPS reverse proxy in front of the app, reachable from pilot users' devices
- [ ] `pnpm prisma migrate deploy` and `pnpm prisma db seed` run successfully
- [ ] Before the finance update: historical released-to-finance backlog resolved (close out the settled history before generating the first payroll run) so the first payroll run can't sweep years of settled jobs — see §7 and the rollout runbook (`docs/prod-finance-rollout.md`)
- [ ] App running under systemd (or pm2), restarts automatically on crash/reboot
- [ ] Seeded test account passwords changed or accounts replaced with real staff
- [ ] Ongoing: any account created by a *later* seed run (e.g. a roster addition) gets `SEED_TEMP_PASSWORD` too — follow up with the same reset for it, every time
- [ ] Daily backup of both the database and the uploads directory configured

Once these are checked off, the app should be reachable at the HTTPS URL configured in `BETTER_AUTH_URL`, ready for the pilot group to log in.
