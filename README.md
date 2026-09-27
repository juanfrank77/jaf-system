# JAF Operations

Operations management system for JAF maintenance jobs: supervisor intake → warehouse pickup (dual signature) → crew field update → supervisor review / Claro submission → finance LC request → receivables tracking. Server-rendered React Router 7 app backed by PostgreSQL (Prisma), with better-auth sessions and an installable PWA for crew field updates.

If you're an AI coding agent working in this repo, start with [AGENTS.md](AGENTS.md) for orientation before making changes.

## Development

Requires Node ≥ 24.3 and pnpm ≥ 10.12. Create a `.env` (see `docs/it-deployment-guide.md` §5 for the variables), then:

```bash
pnpm install
pnpm prisma migrate deploy
pnpm prisma db seed
pnpm run dev
```

## Checks

```bash
pnpm run validate   # typecheck + biome + tests + knip
```

Browser tests need Playwright's Chromium and its system libraries (`pnpm exec playwright install --with-deps chromium`).

## Deployment

On-premise deployment is documented in [docs/it-deployment-guide.md](docs/it-deployment-guide.md).
