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
   - `systemd` service (recommended on Linux servers — see Section 7), or
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

---

## 6. HTTPS is required, not optional

Two features in this app stop working over plain HTTP:
- **PWA / offline mode** for the crew field-update screen — browsers only register service workers over HTTPS (or `localhost`).
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

Run these once, from the project root, with `.env` in place:

```bash
pnpm prisma migrate deploy    # creates all tables
pnpm prisma db seed           # creates initial users, warehouses, service codes, IVU rate
pnpm run build                # production build
pnpm run start                # starts the app on port 3000
```

**Seeded accounts** (all use password `jaf2026!`):

| Email | Role |
|---|---|
| supervisor@jaf.com | Supervisor |
| crew@jaf.com | Crew |
| idalia@jaf.com | Warehouse |
| lissette@jaf.com | Finance |
| admin@jaf.com | Admin |

**Change these passwords (or replace these test accounts with real staff emails) before real users start touching the system.** These are seed/demo credentials meant to get the pilot running, not to ship to real users as-is. We can help script real-user creation if you'd rather not do it by hand.

---

## 8. Keeping it running (process management)

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

## 9. Backups

Two things need to be backed up regularly — losing either loses real client work:

1. **The PostgreSQL database** (all job records, statuses, audit trail):
   ```bash
   pg_dump jaf_operations > jaf_operations_$(date +%F).sql
   ```
2. **The uploads directory** (`UPLOAD_DIR` from Section 5) — photos, signature images, generated PDFs. These are plain files on disk, not in the database, so a database backup alone is not enough.

A daily cron job covering both, with offsite/secondary copy, is the minimum for a pilot. We're happy to help script this once the server is up.

---

## 10. Things to flag back to us before going live with real users

- There is no Dockerfile — this is a plain Node deployment, not a containerized one. If a future phase wants containers, we'll build that properly.
- No lockfile is currently committed to the repo — confirm with us whether we're handing one off alongside the code so versions match what we tested.
- The app runs in production mode automatically when started with `pnpm run start` (`react-router-serve` sets `NODE_ENV=production`); no extra environment variable is needed for that.

---

## 11. Quick sanity checklist

- [ ] Node 24+, pnpm 10+, PostgreSQL installed
- [ ] `.env` created with real `DATABASE_URL`, a freshly generated `BETTER_AUTH_SECRET`, and the correct `BETTER_AUTH_URL`
- [ ] `UPLOAD_DIR` points to a persistent directory, not `/tmp`, and is writable by the app user
- [ ] HTTPS reverse proxy in front of the app, reachable from pilot users' devices
- [ ] `pnpm prisma migrate deploy` and `pnpm prisma db seed` run successfully
- [ ] App running under systemd (or pm2), restarts automatically on crash/reboot
- [ ] Seeded test account passwords changed or accounts replaced with real staff
- [ ] Daily backup of both the database and the uploads directory configured

Once these are checked off, the app should be reachable at the HTTPS URL configured in `BETTER_AUTH_URL`, ready for the pilot group to log in.
