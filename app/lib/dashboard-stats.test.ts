import { describe, expect, it } from "vitest"
import { computeDashboardStats } from "./dashboard-stats"

const doc = (status: string, receivableClosedAt: Date | null = null) => ({
	status: status as never,
	receivableClosedAt,
})

describe("computeDashboardStats", () => {
	it("SUPERVISOR: counts open docs and docs awaiting warehouse/crew", () => {
		const docs = [
			doc("CREATED"),
			doc("PREPPED"),
			doc("SIGNED"),
			doc("LC_GENERATED"),
		]
		const { stats } = computeDashboardStats("SUPERVISOR", docs)
		expect(stats).toEqual([
			{ label: "Open documents", value: 3 },
			{ label: "Awaiting warehouse", value: 1 },
			{ label: "Awaiting crew", value: 2 },
		])
	})

	it("SUPERVISOR: alerts when documents are awaiting warehouse", () => {
		const { alert } = computeDashboardStats("SUPERVISOR", [
			doc("CREATED"),
			doc("CREATED"),
		])
		expect(alert).toEqual({
			variant: "info",
			message: "2 documents awaiting warehouse",
		})
	})

	it("WAREHOUSE: counts pending preps and alerts when > 0", () => {
		const docs = [doc("CREATED"), doc("CREATED"), doc("SIGNED")]
		const { stats, alert } = computeDashboardStats("WAREHOUSE", docs)
		expect(stats).toEqual([{ label: "Pending preps", value: 2 }])
		expect(alert).toEqual({
			variant: "warn",
			message: "2 documents waiting on your prep",
		})
	})

	it("WAREHOUSE: no alert when nothing is pending", () => {
		const { alert } = computeDashboardStats("WAREHOUSE", [doc("SIGNED")])
		expect(alert).toBeNull()
	})

	it("CREW: counts open jobs and jobs awaiting close", () => {
		const docs = [doc("SIGNED"), doc("FIELD_UPDATED"), doc("LC_GENERATED")]
		const { stats, alert } = computeDashboardStats("CREW", docs)
		expect(stats).toEqual([
			{ label: "Open jobs", value: 2 },
			{ label: "Awaiting close", value: 2 },
		])
		expect(alert).toEqual({ variant: "warn", message: "2 jobs ready to close" })
	})

	it("FINANCE: counts total docs, open receivables, awaiting Claro upload", () => {
		const docs = [
			doc("SUPERVISOR_APPROVED"),
			doc("CLARO_UPLOADED"),
			doc("LC_GENERATED", new Date("2026-01-01")),
			doc("CREATED"),
		]
		const { stats, alert } = computeDashboardStats("FINANCE", docs)
		expect(stats).toEqual([
			{ label: "Total documents", value: 4 },
			{ label: "Open receivables", value: 2 },
			{ label: "Awaiting Claro upload", value: 1 },
		])
		expect(alert).toEqual({ variant: "info", message: "2 receivables open" })
	})

	it("ADMIN: uses the same computation as FINANCE", () => {
		const docs = [doc("CLARO_UPLOADED")]
		expect(computeDashboardStats("ADMIN", docs)).toEqual(
			computeDashboardStats("FINANCE", docs),
		)
	})

	it("returns no alert when the doc list is empty", () => {
		expect(computeDashboardStats("SUPERVISOR", []).alert).toBeNull()
	})
})
