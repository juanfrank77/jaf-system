import { describe, expect, it } from "vitest"
import { navGroupsFor, tabBarItemsFor } from "./nav-model"

const tos = (groups: ReturnType<typeof navGroupsFor>) =>
	groups.map((g) => [g.key, g.items.map((i) => i.to)])

describe("navGroupsFor", () => {
	it("groups SUPERVISOR items under overview and work", () => {
		expect(tos(navGroupsFor("SUPERVISOR"))).toEqual([
			["overview", ["/dashboard"]],
			["work", ["/docs/new", "/supervisor/brigades"]],
		])
	})

	it("shows Variance to SUPERVISOR only when ENABLE_VARIANCE is on", () => {
		expect(tos(navGroupsFor("SUPERVISOR", { varianceEnabled: true }))).toEqual([
			["overview", ["/dashboard"]],
			["work", ["/docs/new", "/supervisor/brigades", "/supervisor/variance"]],
		])
	})

	it("gives INSTALLER no Dashboard, only the Installer item", () => {
		expect(tos(navGroupsFor("INSTALLER"))).toEqual([["field", ["/installer"]]])
	})

	it("gives CREW only the dashboard", () => {
		expect(tos(navGroupsFor("CREW"))).toEqual([["overview", ["/dashboard"]]])
	})

	it("groups FINANCE items under overview and money, with payroll between queue and receivables", () => {
		expect(tos(navGroupsFor("FINANCE"))).toEqual([
			["overview", ["/dashboard"]],
			["money", ["/finance/queue", "/finance/payroll", "/finance/receivables"]],
		])
	})

	it("omits empty groups and keeps a fixed group order for ADMIN", () => {
		const keys = navGroupsFor("ADMIN", { comptrollerEnabled: true }).map(
			(g) => g.key,
		)
		expect(keys).toEqual([
			"overview",
			"work",
			"money",
			"stock",
			"field",
			"admin",
		])
	})

	it("hides the comptroller item unless the flag is on", () => {
		const flat = (on: boolean) =>
			navGroupsFor("ADMIN", { comptrollerEnabled: on }).flatMap((g) =>
				g.items.map((i) => i.to),
			)
		expect(flat(false)).not.toContain("/comptroller")
		expect(flat(true)).toContain("/comptroller")
	})
})

describe("tabBarItemsFor", () => {
	it("is empty for roles that do not use a tab bar", () => {
		expect(tabBarItemsFor("SUPERVISOR")).toEqual([])
		expect(tabBarItemsFor("ADMIN")).toEqual([])
	})

	it("is empty when the role has fewer than two items (CREW today)", () => {
		expect(tabBarItemsFor("CREW")).toEqual([])
	})

	it("gives INSTALLER Home, New job and My van", () => {
		const tabs = tabBarItemsFor("INSTALLER")
		expect(tabs.map((i) => i.to)).toEqual([
			"/installer",
			"/installer/completion/new",
			"/installer/van",
		])
		expect(tabs.map((i) => i.labelKey)).toEqual([
			"app_shell.nav.installer_home",
			"app_shell.nav.installer_new_job",
			"app_shell.nav.installer_van",
		])
		// Home is exact so it is not active on every /installer/* page.
		expect(tabs[0].exact).toBe(true)
	})
})
