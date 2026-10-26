import { describe, expect, it } from "vitest"
import { isNavItemActive, navGroupsFor, tabBarItemsFor } from "./nav-model"

const tos = (groups: ReturnType<typeof navGroupsFor>) =>
	groups.map((g) => [g.key, g.items.map((i) => i.to)])

describe("navGroupsFor", () => {
	it("gives SUPERVISOR the step-rail queues after New document, with Brigades in a separate section", () => {
		expect(tos(navGroupsFor("SUPERVISOR"))).toEqual([
			["overview", ["/dashboard"]],
			[
				"work",
				[
					"/docs/new",
					"/dashboard?stage=open",
					"/dashboard?stage=invoice",
					"/dashboard?stage=aviso",
					"/dashboard?stage=precert",
					"/dashboard?stage=released",
					"/dashboard?stage=all",
				],
			],
			["team", ["/supervisor/brigades"]],
		])
	})

	it("hides the Review queue from SUPERVISOR but keeps open jobs and packets", () => {
		const items = navGroupsFor("SUPERVISOR").flatMap((g) =>
			g.items.map((i) => i.to),
		)
		expect(items).toContain("/dashboard?stage=open")
		expect(items).toContain("/dashboard?stage=invoice")
		expect(items).not.toContain("/dashboard?stage=review")
		const labels = navGroupsFor("SUPERVISOR").flatMap((g) =>
			g.items.map((i) => i.labelKey),
		)
		expect(labels).toContain("app_shell.nav.supervisor_open")
		expect(labels).toContain("app_shell.nav.supervisor_invoice")
	})

	it("shows Variance to SUPERVISOR only when ENABLE_VARIANCE is on", () => {
		expect(tos(navGroupsFor("SUPERVISOR", { varianceEnabled: true }))).toEqual([
			["overview", ["/dashboard"]],
			[
				"work",
				[
					"/docs/new",
					"/dashboard?stage=open",
					"/dashboard?stage=invoice",
					"/dashboard?stage=aviso",
					"/dashboard?stage=precert",
					"/dashboard?stage=released",
					"/dashboard?stage=all",
				],
			],
			["team", ["/supervisor/brigades", "/supervisor/variance"]],
		])
	})

	it("gives INSTALLER no Dashboard, only the Installer item", () => {
		expect(tos(navGroupsFor("INSTALLER"))).toEqual([["field", ["/installer"]]])
	})

	it("gives CREW nothing: crew accounts no longer sign in", () => {
		expect(navGroupsFor("CREW")).toEqual([])
	})

	it("groups FINANCE items into Arm A and Arm B, in process order", () => {
		expect(tos(navGroupsFor("FINANCE"))).toEqual([
			["overview", ["/dashboard"]],
			["arm_a", ["/finance/queue", "/finance/lc-requests", "/finance/payroll"]],
			[
				"arm_b",
				[
					"/finance/awaiting-po",
					"/finance/awaiting-ariba",
					"/finance/payment-advice",
					"/finance/avisos",
					"/finance/ledger",
					"/finance/receivables",
				],
			],
		])
	})

	it("has no disabled placeholder left on the FINANCE menu", () => {
		const items = navGroupsFor("FINANCE").flatMap((g) => g.items)
		const disabled = items.filter((i) => i.disabled).map((i) => i.to)
		expect(disabled).toEqual([])
	})

	it("gives WAREHOUSE a Work link per owned step first, then Workflow, then the other links", () => {
		expect(tos(navGroupsFor("WAREHOUSE"))).toEqual([
			["overview", ["/dashboard"]],
			["work", ["/warehouse/prep", "/warehouse/release", "/warehouse/returns"]],
			[
				"workflow",
				[
					"/warehouse/scan-in",
					"/warehouse/triage",
					"/warehouse/needs-review",
					"/warehouse/repairs",
					"/warehouse/restock",
					"/warehouse/stock",
				],
			],
			[
				"other",
				["/warehouse/requests", "/warehouse/serials", "/warehouse/movements"],
			],
		])
	})

	it("keeps ADMIN's Warehouse links in their own group, unchanged", () => {
		const stock = navGroupsFor("ADMIN").find((g) => g.key === "stock")
		expect(stock?.items.map((i) => i.to)).toEqual([
			"/warehouse/scan-in",
			"/warehouse/restock",
			"/warehouse/stock",
		])
	})

	it("omits empty groups and keeps a fixed group order for ADMIN", () => {
		const keys = navGroupsFor("ADMIN").map((g) => g.key)
		expect(keys).toEqual([
			"overview",
			"work",
			"arm_a",
			"arm_b",
			"money",
			"installers",
			"team",
			"stock",
			"field",
			"admin",
		])
	})

	it("gives COMPTROLLER its own dashboard, one Payroll requests item, the log and an Installers group", () => {
		expect(tos(navGroupsFor("COMPTROLLER"))).toEqual([
			["overview", ["/comptroller"]],
			["money", ["/comptroller/to-pay", "/comptroller/log"]],
			[
				"installers",
				[
					"/comptroller/installers",
					"/comptroller/installers/ewit",
					"/comptroller/installers/batches",
					"/comptroller/installers/pay",
				],
			],
			["team", ["/comptroller/brigades"]],
		])
	})

	it("keeps finance screens away from COMPTROLLER and the payroll queues open to ADMIN", () => {
		const flat = (role: "COMPTROLLER" | "ADMIN") =>
			navGroupsFor(role).flatMap((g) => g.items.map((i) => i.to))
		expect(flat("COMPTROLLER").some((to) => to.startsWith("/finance"))).toBe(
			false,
		)
		expect(flat("ADMIN")).toContain("/comptroller/to-pay")
	})
})

describe("isNavItemActive", () => {
	const at = (pathname: string, search = "", hash = "") => ({
		pathname,
		search,
		hash,
	})

	it("matches a plain link only when no queue is selected", () => {
		expect(isNavItemActive("/dashboard", at("/dashboard"))).toBe(true)
		expect(
			isNavItemActive("/dashboard", at("/dashboard", "?stage=review")),
		).toBe(false)
		expect(
			isNavItemActive("/dashboard", at("/dashboard", "", "#to-prep")),
		).toBe(false)
	})

	it("matches a supervisor queue by its stage and no other", () => {
		const here = at("/dashboard", "?stage=aviso")
		expect(isNavItemActive("/dashboard?stage=aviso", here)).toBe(true)
		expect(isNavItemActive("/dashboard?stage=review", here)).toBe(false)
	})

	it("matches a warehouse queue by its anchor and leaves the plain link inactive", () => {
		const here = at("/warehouse/stock", "", "#serials")
		expect(isNavItemActive("/warehouse/stock#serials", here)).toBe(true)
		expect(isNavItemActive("/warehouse/stock#inventory", here)).toBe(false)
		expect(isNavItemActive("/warehouse/stock", here)).toBe(false)
		expect(isNavItemActive("/warehouse/stock", at("/warehouse/stock"))).toBe(
			true,
		)
	})

	it("never matches a different path", () => {
		expect(isNavItemActive("/comptroller/paid", at("/comptroller/lists"))).toBe(
			false,
		)
	})

	it("keeps Payroll requests lit on the Paid tab and on a request page", () => {
		expect(
			isNavItemActive("/comptroller/to-pay", at("/comptroller/paid")),
		).toBe(true)
		expect(
			isNavItemActive("/comptroller/to-pay", at("/comptroller/runs/abc")),
		).toBe(true)
		expect(isNavItemActive("/comptroller/to-pay", at("/comptroller"))).toBe(
			false,
		)
	})
})

describe("tabBarItemsFor", () => {
	it("is empty for roles that do not use a tab bar", () => {
		expect(tabBarItemsFor("SUPERVISOR")).toEqual([])
		expect(tabBarItemsFor("ADMIN")).toEqual([])
	})

	it("gives CREW no tab bar", () => {
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
