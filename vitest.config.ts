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
		// Worktrees live inside the repo root — either the manual fallback
		// convention (.worktrees/<branch>/) or the harness's native worktree
		// tool (.claude/worktrees/<name>/) — so without this, running from the
		// main checkout picks up every test file twice: once here, once inside
		// the worktree. Each worktree also has its own node_modules/generated
		// Prisma client, so its test files fail to resolve against this
		// checkout's, and both copies would run concurrently against the same
		// DATABASE_URL regardless, causing unique-constraint collisions and
		// connection-pool exhaustion between the two runs.
		exclude: [
			"**/node_modules/**",
			"**/.worktrees/**",
			"**/.claude/worktrees/**",
		],
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
