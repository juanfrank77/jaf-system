#!/usr/bin/env bash
#
# Apply pending Prisma migrations to a remote production database.
# Idempotent + forward-only: `migrate deploy` only runs migrations that
# `_prisma_migrations` doesn't yet record; it never rolls back.
#
set -euo pipefail

# Resolve project root from this script's location.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Load .env for local/dev runs; production should set these via its
# systemd EnvironmentFile (see docs/it-deployment-guide.md §7).
if [[ ! -n "${DATABASE_URL:-}" && -f ".env" ]]; then
	# shellcheck disable=SC1091
	source .env
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
	echo "FATAL: DATABASE_URL is not set. Export it or create a .env file." >&2
	exit 1
fi

echo "==> Database: ${DATABASE_URL%%@*@}"
echo "==> Pending migrations before:"

# Refresh the Prisma client first so it matches the committed schema (the
# generated client is gitignored and must be rebuilt on a fresh deploy).
echo "==> prisma generate"
pnpm prisma generate

echo "==> Applying pending migrations (prisma migrate deploy)..."
pnpm prisma migrate deploy

echo "==> Migration status:"
pnpm prisma migrate status

echo "==> Done. Schema additions for Phase 2 Layer 0 are now deployed."
