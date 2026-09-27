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
		// Worktrees live inside the repo root (.worktrees/<branch>/), so without
		// this, running from the main checkout picks up every test file twice —
		// once here, once inside the worktree — and both copies run
		// concurrently against the same DATABASE_URL, causing unique-constraint
		// collisions and connection-pool exhaustion between the two runs.
		exclude: ["**/node_modules/**", "**/.worktrees/**"],
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
