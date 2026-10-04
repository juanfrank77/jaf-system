# JAF System

Orient yourself with the README.md file. 
Whenever necessary read the files in the docs/ folder.

## Branches

- **`master`** is what the on-prem prod server deploys from (see
  `docs/it-deployment-guide.md`). All shared work lands here — schema,
  routes, tests, product docs, and repo config (this file, `.gitignore`,
  `vitest.config.ts`, `lefthook.yml`) — via feature branches opened as PRs
  against `master`. **Never force-push `master`.**
- **Machine-local tooling stays out of git, not on a branch.** The pre-push
  production-build check (`pnpm run build`, which catches react-router
  client/server code-splitting errors the test suite misses) lives in a
  **gitignored `lefthook-local.yml`** that lefthook merges on top of the
  tracked `lefthook.yml`. It is active on every branch locally and never
  reaches `origin`/prod. Put any other personal, machine-specific hook or
  override there. If `.git/hooks/pre-push` is missing, run
  `pnpm exec lefthook install`.

  (This replaces the former local-only `dev-tooling` branch, now removed: a
  floating tooling branch was easy to mishandle across worktrees and resets;
  a gitignored local file is not, and it works from any branch without
  branch-switching.)

- **After switching branches, run `pnpm prisma generate`.** The generated
  Prisma client (`generated/prisma`, gitignored) is shared across a single
  checkout, so switching to a branch whose `prisma/schema.prisma` differs
  leaves the client stale — typecheck and build fail against the wrong types
  until you regenerate (or run `prisma db push` / `prisma migrate reset`).
  Worktrees avoid this by each carrying their own client.

## Worktrees

Create worktrees only under `.worktrees/<branch>/` — the repo's single
worktree convention, and the only path excluded from vitest's test glob
(`vitest.config.ts`). Use `git worktree add .worktrees/<branch>`; do **not**
use a harness's native worktree tool that places them elsewhere (e.g. under
`.claude/worktrees/`), since those are not excluded and would run every test
file twice. Don't run the full test suite from inside a worktree and expect
it to also validate the main checkout, or vice versa — each worktree has its
  own `node_modules` and generated Prisma client.

## Keeping schema and migrations in sync

There is no automated drift check in CI, so this is kept in sync by hand. After
editing `prisma/schema.prisma` or any migration, replay the whole chain into a
scratch database and diff it against the schema:

```bash
# DATABASE_URL = the scratch database; SHADOW_DATABASE_URL = a second, throwaway
# one (both in the gitignored .env — never commit a URL).
pnpm prisma migrate deploy

pnpm prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema prisma/schema.prisma \
  --exit-code
```

No output and exit code 0 means the chain and the schema agree. **Any SQL output
means they disagree — fix one before merging.** "No shadow database configured"
is a *failed* check, not a pass; without `SHADOW_DATABASE_URL` Prisma silently
creates and abandons a `prisma_migrate_shadow_db_*` database each run.

Two rules, in order of how expensive they are to get wrong:

- **Never edit a migration that prod has already applied.** Prod's
  `_prisma_migrations` records a checksum; changing the file makes the chain
  diverge from the database and forces a destructive reset. The same goes for a
  migration hand-edited away from Prisma's generated SQL — e.g. 
  `warehouse_foundation` uses `ALTER ... RENAME` so the production `van_movement` 
  ledger survives; a `migrate dev` regeneration would rewrite it to 
  `DROP`/`CREATE` and destroy that data.
- **Editing or deleting a migration prod has *not* run yet is safe**, and is the
  intended way to keep the history tidy. Squashing two undeployed migrations
  into one is the right move when a second one only adds a column to a table the
  first one created. Check what prod has actually applied before assuming:
  `git ls-tree origin/master:prisma/migrations`.

