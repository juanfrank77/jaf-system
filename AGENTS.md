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
