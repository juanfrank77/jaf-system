import { describe, expect, it } from "vitest"
import { navGroupsFor, tabBarItemsFor } from "./nav-model"

const tos = (groups: ReturnType<typeof navGroupsFor>) =>
	groups.map((g) => [g.key, g.items.map((i) => i.to)])

describe("navGroupsFor", () => {
	it("groups SUPERVISOR items under overview and work", () => {
		expect(tos(navGroupsFor("SUPERVISOR"))).toEqual([
			["overview", ["/dashboard"]],
			["work", ["/docs/new", "/supervisor/brigades", "/supervisor/variance"]],
		])
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

	it("lists INSTALLER's items", () => {
		expect(tabBarItemsFor("INSTALLER").map((i) => i.to)).toEqual([
			"/dashboard",
			"/installer",
		])
	})
})
