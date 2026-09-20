import { describe, expect, it } from "vitest"
import {
	computeExecDashboard,
	type ExecDashboardInput,
	type ExecInvoiceInput,
	formatCompactMoney,
} from "./exec-dashboard"

// Friday 19 Sep 2026, 09:00 local.
const NOW = new Date(2026, 8, 19, 9, 0, 0)

const invoice = (
	overrides: Partial<ExecInvoiceInput> & { id: string },
): ExecInvoiceInput => ({
	controlNumber: `JAF-${overrides.id}`,
	avisoNumber: `M17-${overrides.id}`,
	status: "CLARO_UPLOADED",
	createdAt: new Date(2026, 0, 10),
	supervisorApprovedAt: new Date(2026, 0, 20),
	claroPdfPath: "/claro.pdf",
	receivableClosedAt: null,
	amount: 1000,
	avisoLineTotal: null,
	avisoMatchedAt: null,
	poAmounts: [],
	crewPaidAt: null,
	stage: "WAITING_CLARO_PO",
	stageDays: 0,
	brigadeName: "Rivera",
	...overrides,
})

const base = (
	overrides: Partial<ExecDashboardInput> = {},
): ExecDashboardInput => ({
	invoices: [],
	fieldJobs: [],
	avisoJobs: [],
	installersTotal: 0,
	installersOnRoadToday: 0,
	brigadeAreas: [],
	restockRequests: [],
	tolerance: 0.01,
	agingAlertDays: 30,
	...overrides,
})

describe("computeExecDashboard", () => {
	it("sums sold, POs received and the open balance for the current year", () => {
		const data = computeExecDashboard(
			base({
				invoices: [
					invoice({ id: "a", amount: 8271.91, poAmounts: [7957.25] }),
					invoice({ id: "b", amount: 606.38, poAmounts: [] }),
					// Last year's work is not part of this year's figures.
					invoice({
						id: "old",
						amount: 5000,
						crewPaidAt: new Date(2025, 11, 1),
					}),
				],
			}),
			NOW,
		)
		expect(data.year).toBe(2026)
		expect(data.money.sold).toBeCloseTo(8878.29, 2)
		expect(data.money.poReceived).toBeCloseTo(7957.25, 2)
		expect(data.money.open).toBeCloseTo(921.04, 2)
		expect(data.money.openPct).toBe(10)
	})

	it("attributes each job to the month the brigade was paid, else approval, else creation", () => {
		const data = computeExecDashboard(
			base({
				invoices: [
					invoice({
						id: "paid",
						amount: 100,
						crewPaidAt: new Date(2026, 3, 29),
					}),
					invoice({
						id: "approved",
						amount: 200,
						supervisorApprovedAt: new Date(2026, 1, 18),
						poAmounts: [150],
					}),
					invoice({
						id: "created",
						amount: 300,
						supervisorApprovedAt: null,
						createdAt: new Date(2026, 7, 3),
					}),
				],
				avisoJobs: [
					{ createdAt: new Date(2026, 0, 5) },
					{ createdAt: new Date(2026, 0, 6) },
					{ createdAt: new Date(2025, 5, 1) },
				],
			}),
			NOW,
		)
		// January through September.
		expect(data.months).toHaveLength(9)
		expect(data.months[3]).toMatchObject({ month: 3, sold: 100, po: 0 })
		expect(data.months[1]).toMatchObject({ month: 1, sold: 200, po: 150 })
		expect(data.months[7]).toMatchObject({ month: 7, sold: 300, po: 0 })
		expect(data.months[0]?.avisos).toBe(2)
		expect(data.avisos.count).toBe(2)
	})

	it("counts open receivables with no PO and ignores closed ones", () => {
		const data = computeExecDashboard(
			base({
				invoices: [
					invoice({ id: "a" }),
					invoice({ id: "b", poAmounts: [1000] }),
					invoice({ id: "c", receivableClosedAt: new Date(2026, 5, 1) }),
				],
			}),
			NOW,
		)
		expect(data.avisos.receivablesOpen).toBe(2)
		expect(data.avisos.noPo).toBe(1)
		expect(data.avisos.noPoPct).toBe(50)
	})

	it("flags short POs as critical and lists them in collections with the balance", () => {
		const data = computeExecDashboard(
			base({
				invoices: [
					invoice({
						id: "short",
						amount: 8271.91,
						poAmounts: [7957.25],
						crewPaidAt: new Date(2026, 3, 29),
					}),
					invoice({ id: "ok", amount: 500, poAmounts: [500] }),
				],
			}),
			NOW,
		)
		expect(data.shortPoCount).toBe(1)
		const item = data.attention.find((a) => a.kind === "po_short")
		expect(item).toMatchObject({
			level: "critical",
			href: "/docs/short",
			params: { aviso: "M17-short", diff: "314.66" },
		})
		expect(data.collections).toHaveLength(1)
		expect(data.collections[0]).toMatchObject({
			id: "short",
			problem: "po_short",
			daysOut: 143,
		})
		expect(data.collections[0]?.balance).toBeCloseTo(-314.66, 2)
	})

	it("lists jobs with no PO in collections, oldest first", () => {
		const data = computeExecDashboard(
			base({
				invoices: [
					invoice({ id: "new", crewPaidAt: new Date(2026, 8, 1) }),
					invoice({ id: "old", crewPaidAt: new Date(2026, 1, 18) }),
				],
			}),
			NOW,
		)
		expect(data.collections.map((r) => r.id)).toEqual(["old", "new"])
		expect(data.collections[0]).toMatchObject({
			problem: "no_po",
			daysOut: 213,
		})
	})

	it("raises aging, aviso mismatch, missing aviso and missing PDF items", () => {
		const data = computeExecDashboard(
			base({
				invoices: [
					invoice({ id: "aging", stageDays: 45 }),
					invoice({ id: "aging-critical", stageDays: 90 }),
					invoice({ id: "not-aging", stage: "TO_VERIFY", stageDays: 90 }),
					invoice({ id: "mismatch", amount: 586.37, avisoLineTotal: 11623.28 }),
					invoice({ id: "matched", amount: 586.37, avisoLineTotal: 586.37 }),
					invoice({ id: "no-aviso", avisoNumber: null }),
					invoice({
						id: "no-pdf",
						status: "SUPERVISOR_APPROVED",
						claroPdfPath: null,
					}),
				],
			}),
			NOW,
		)
		const byKind = (kind: string) =>
			data.attention.filter((a) => a.kind === kind).map((a) => a.id)
		expect(byKind("aging")).toEqual(
			expect.arrayContaining(["aging:aging", "aging:aging-critical"]),
		)
		expect(byKind("aging")).not.toContain("aging:not-aging")
		expect(
			data.attention.find((a) => a.id === "aging:aging-critical")?.level,
		).toBe("critical")
		expect(data.attention.find((a) => a.id === "aging:aging")?.level).toBe(
			"watch",
		)
		expect(byKind("aviso_mismatch")).toEqual(["aviso_mismatch:mismatch"])
		expect(byKind("missing_aviso")).toEqual(["missing_aviso:no-aviso"])
		expect(byKind("missing_claro_pdf")).toEqual(["missing_claro_pdf:no-pdf"])
		// Critical items come first.
		const levels = data.attention.map((a) => a.level)
		expect(levels.indexOf("watch")).toBeGreaterThan(
			levels.lastIndexOf("critical"),
		)
	})

	it("summarises field, installers, brigades and restock requests", () => {
		const data = computeExecDashboard(
			base({
				invoices: [
					invoice({
						id: "wk",
						amount: 41200,
						crewPaidAt: new Date(2026, 8, 15),
					}),
					invoice({
						id: "last-wk",
						amount: 999,
						crewPaidAt: new Date(2026, 8, 10),
					}),
				],
				fieldJobs: [
					{ supervisorName: "Rivera" },
					{ supervisorName: "Rivera" },
					{ supervisorName: "Ocasio" },
					{ supervisorName: null },
				],
				installersTotal: 54,
				installersOnRoadToday: 31,
				brigadeAreas: ["NORTE", "NORTE", "SUR", null],
				restockRequests: [
					{ status: "REQUESTED", warehouseName: "Guaynabo" },
					{ status: "PENDING_APPROVAL", warehouseName: "Guaynabo" },
					{ status: "PENDING_APPROVAL", warehouseName: "Arecibo" },
					{ status: "READY", warehouseName: "Arecibo" },
				],
			}),
			NOW,
		)
		expect(data.field.inField).toBe(4)
		expect(data.field.bySupervisor).toEqual([
			{ name: "Rivera", count: 2 },
			{ name: "Ocasio", count: 1 },
			{ name: "—", count: 1 },
		])
		expect(data.field.installersTotal).toBe(54)
		expect(data.field.installersOnRoad).toBe(31)
		expect(data.field.paidThisWeek).toBe(41200)
		expect(data.field.brigadesActive).toBe(4)
		expect(data.field.brigadesByArea[0]).toEqual({ name: "NORTE", count: 2 })
		expect(data.warehouse).toMatchObject({
			requested: 1,
			pendingApproval: 2,
			approved: 0,
			ready: 1,
		})
		expect(data.warehouse.byWarehouse).toEqual([
			{ name: "Arecibo", count: 2 },
			{ name: "Guaynabo", count: 2 },
		])
		expect(data.attention).toContainEqual(
			expect.objectContaining({
				kind: "restock_approval",
				href: "/admin/restock",
				params: { count: 2 },
			}),
		)
	})
})

describe("formatCompactMoney", () => {
	it("formats thousands and millions", () => {
		expect(formatCompactMoney(482411)).toBe("$482K")
		expect(formatCompactMoney(2_490_000)).toBe("$2.49M")
		expect(formatCompactMoney(1250)).toBe("$1.3K")
		expect(formatCompactMoney(812.08)).toBe("$812")
		expect(formatCompactMoney(-314.66)).toBe("-$315")
		expect(formatCompactMoney(0)).toBe("$0")
	})
})
