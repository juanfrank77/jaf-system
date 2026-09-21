import { describe, expect, it } from "vitest"
import type { Role } from "../../generated/prisma/client"
import { filterNavItems, NAV_ITEMS, visibleNavPaths } from "./app-shell-nav"

const ROLES: Role[] = [
	"SUPERVISOR",
	"CREW",
	"WAREHOUSE",
	"FINANCE",
	"ADMIN",
	"INSTALLER",
	"COMPTROLLER",
]

describe("app-shell-nav parity", () => {
	for (const role of ROLES) {
		for (const comptrollerEnabled of [true, false] as const) {
			it(`role ${role} comptroller=${comptrollerEnabled}`, () => {
				const options = { comptrollerEnabled }
				const once = visibleNavPaths({ role }, options)
				const twice = filterNavItems(NAV_ITEMS, { role }, options).map(
					(item) => item.to,
				)
				expect(once).toEqual(twice)
			})
		}
	}

	it("hides comptroller for admin when flag is off", () => {
		const paths = visibleNavPaths(
			{ role: "ADMIN" },
			{ comptrollerEnabled: false },
		)
		expect(paths).not.toContain("/comptroller")
	})

	it("shows comptroller for admin when flag is on", () => {
		const paths = visibleNavPaths(
			{ role: "ADMIN" },
			{ comptrollerEnabled: true },
		)
		expect(paths).toContain("/comptroller")
	})

	it("crew only sees dashboard", () => {
		expect(
			visibleNavPaths({ role: "CREW" }, { comptrollerEnabled: true }),
		).toEqual(["/dashboard"])
	})
})
