# JAF System

Orient yourself with the README.md file. 
Whenever necessary read the files in the docs/ folder.

## Branches

- **`master`** is what the on-prem prod server deploys from (see
  `docs/it-deployment-guide.md`). Only functionality/product commits belong
  here — schema, routes, tests, docs about the product itself.
- **`dev-tooling`** is a local-only branch that layers dev-only,
  machine/editor-local commits on top of `master` (git hooks in
  `lefthook.yml`, this file, local convenience scripts). It is never pushed
  to `origin` and prod never sees it.

**If you're a coding agent about to commit something that is purely
dev/tooling** (a git hook, an editor config file, an agent-orientation doc
like this one that isn't already tracked on `master`) **and `master` is the
checked-out branch, STOP and ask first** rather than committing it to
`master` — check whether it belongs on `dev-tooling` instead. When in
doubt, ask the user which branch a change belongs on.

To bring `dev-tooling` up to date after `master` has moved forward (e.g. a
PR merged):

```bash
git checkout dev-tooling
git rebase master
```

This is a **local-only** operation. **NEVER push `dev-tooling` to
`origin`, and NEVER force-push `master`.**

## Worktrees

This repo uses two worktree conventions, both excluded from vitest's test
glob (`vitest.config.ts`): the harness's native worktree tool places
worktrees under `.claude/worktrees/<name>/`; the manual fallback convention
is `.worktrees/<branch>/`. Don't run the full test suite from inside a
worktree and expect it to also validate the main checkout, or vice versa —
each worktree has its own `node_modules` and generated Prisma client.
