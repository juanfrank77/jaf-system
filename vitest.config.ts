import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

export default defineConfig({
	plugins: [tailwindcss()],
	resolve: {
		alias: {
			"~": path.resolve(import.meta.dirname, "./app"),
		},
	},
	test: {
		globals: true,
		css: true,
		// Worktrees live under .worktrees/<branch>/ (the repo's single
		// worktree convention — see AGENTS.md) — so without this, running from
		// the main checkout picks up every test file twice: once here, once
		// inside the worktree. Each worktree also has its own node_modules/
		// generated Prisma client, so its test files fail to resolve against
		// this checkout's, and both copies would run concurrently against the
		// same DATABASE_URL regardless, causing unique-constraint collisions
		// and connection-pool exhaustion between the two runs.
		exclude: [
			"**/node_modules/**",
			"**/.worktrees/**",
		],
		// Each server-test fork gets its own PrismaClient with a pool capped
		// at 3 (db.server.ts) — the default fork count (~cpus - 1, 11 here)
		// still adds up to ~33 concurrent connections against the shared
		// Neon dev DB, which exhausts it under the full 84-file suite and
		// times out unrelated files' queries. Capping forks keeps peak
		// connections well under the DB's limit. (Harmless for the browser
		// project, which executes via its own browser provider.)
		maxWorkers: 2,
		coverage: {
			include: ["app/**"],
			reporter: ["text", "json-summary", "json"],
			reportOnFailure: true,
		},
		projects: [
			{
				extends: true,
				test: {
					name: "server tests",
					environment: "node",
					// Even at low concurrency, a query against the shared dev DB
					// occasionally queues behind other load (other sessions/branches
					// hitting the same instance) and blows the 5s default — bump the
					// budget instead of failing tests that would otherwise pass.
					testTimeout: 15000,
					include: [
						"./**/*.server.test.{ts,tsx}",
						"./**/*.test.{ts,tsx}",
						"!./**/*.browser.test.{ts,tsx}",
					],
				},
			},
			{
				extends: true,
				optimizeDeps: {
					include: [
						"react/jsx-dev-runtime",
						"class-variance-authority",
						"clsx",
						"tailwind-merge",
					],
				},
				server: {
					fs: { strict: false },
				},
				test: {
					includeTaskLocation: true,
					include: [
						"./**/*.test.{ts,tsx}",
						"./**/*.browser.test.{ts,tsx}",
						"!./**/*.server.test.{ts,tsx}",
					],
					setupFiles: ["./tests/setup.browser.tsx"],
					name: "browser tests",
					browser: {
						enabled: true,
						headless: true,
						instances: [{ browser: "chromium" }],
						provider: playwright(),
					},
				},
			},
		],
	},
})
