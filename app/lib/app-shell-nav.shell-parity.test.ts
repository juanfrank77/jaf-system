import { describe, expect, it } from "vitest"
import type { Role } from "../../generated/prisma/client"
import { filterNavItems, NAV_ITEMS, visibleNavPaths } from "./app-shell-nav"

/**
 * v1 AppShell and DesignSystemAppShell both call filterNavItems(NAV_ITEMS, …).
 * These cases mirror app-shell.browser.test.tsx role expectations.
 */
const ROLES: Role[] = [
	"SUPERVISOR",
	"CREW",
	"WAREHOUSE",
	"FINANCE",
	"ADMIN",
	"INSTALLER",
	"COMPTROLLER",
]

describe("shell nav parity (shared filterNavItems)", () => {
	for (const role of ROLES) {
		for (const comptrollerEnabled of [true, false] as const) {
			it(`${role} comptroller=${comptrollerEnabled}`, () => {
				const user = { role }
				const options = { comptrollerEnabled }
				const fromHelper = visibleNavPaths(user, options)
				const fromFilter = filterNavItems(NAV_ITEMS, user, options).map(
					(item) => item.to,
				)
				expect(fromHelper).toEqual(fromFilter)
			})
		}
	}

	it("admin with comptroller off matches v1 browser test nav order", () => {
		const paths = visibleNavPaths(
			{ role: "ADMIN" },
			{ comptrollerEnabled: false },
		)
		expect(paths).toEqual([
			"/dashboard",
			"/finance/queue",
			"/finance/receivables",
			"/admin/restock",
			"/installer",
			"/admin/crews",
			"/admin/vans",
			"/admin/catalog",
			"/admin/users",
			"/admin/settings",
		])
	})
})
