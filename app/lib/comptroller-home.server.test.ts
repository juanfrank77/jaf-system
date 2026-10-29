import { afterAll, describe, expect, it } from "vitest"
import { loadComptrollerHome } from "~/lib/comptroller-home.server"
import { db } from "~/lib/db.server"
import { makeTracker, seedUser } from "~/test/helpers"

const t = makeTracker()
afterAll(() => t.cleanup())

const NOW = new Date("2026-10-28T16:00:00Z")
const DAY = 86_400_000
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY)

const tile = (
	home: Awaited<ReturnType<typeof loadComptrollerHome>>,
	key: string,
) => {
	const found = home.tiles.find((x) => x.key === key)
	if (!found) throw new Error(`no tile ${key}`)
	return found
}

describe("loadComptrollerHome", () => {
	it("counts each Claro stage once, with amounts and ages", async () => {
		const before = await loadComptrollerHome(NOW)
		const carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const batch = t.track(
			"ewitBatch",
			await db.ewitBatch.create({
				data: {
					createdById: carmen.id,
					sentAt: daysAgo(94),
					closedAt: daysAgo(95),
				},
			}),
		)
		const base = 9500000 + Math.floor(Math.random() * 400000)
		let k = 0
		const mk = async (data: Record<string, unknown>) =>
			t.track(
				"ewitInvoice",
				await db.ewitInvoice.create({
					data: {
						number: `JA${base + k++}`,
						invoiceDate: daysAgo(100),
						total: 1000,
						filePath: "/files/x.pdf",
						createdById: carmen.id,
						batchId: batch.id,
						...data,
					} as never,
				}),
			)
		// no_po
		await mk({ total: 2000 })
		// ready_for_ariba
		await mk({ poNumber: "PO1", claroTotal: 1040 })
		// sent, over 60 days (also "missing")
		await mk({
			poNumber: "PO2",
			claroTotal: 1040,
			aribaSentAt: daysAgo(70),
		})
		// short: JA1616329 shape
		await mk({
			total: 4900,
			poNumber: "PO3",
			claroTotal: 5097.08,
			aribaSentAt: daysAgo(30),
			claroPaidAt: daysAgo(5),
			claroPaidNet: 5059.63,
		})
		// fully paid
		await mk({
			poNumber: "PO4",
			claroTotal: 1040,
			aribaSentAt: daysAgo(30),
			claroPaidAt: daysAgo(5),
			claroPaidNet: 1040,
		})

		const after = await loadComptrollerHome(NOW)
		const d = (key: string) => ({
			b: tile(before, key),
			a: tile(after, key),
		})

		const po = d("ja_waiting_po")
		expect((po.a.count ?? 0) - (po.b.count ?? 0)).toBe(1)
		expect((po.a.amount ?? 0) - (po.b.amount ?? 0)).toBeCloseTo(2000, 2)
		expect(po.a.oldestDays).toBeGreaterThanOrEqual(94)

		const rs = d("ready_or_sent_not_paid")
		expect((rs.a.count ?? 0) - (rs.b.count ?? 0)).toBe(2)
		expect((rs.a.amount ?? 0) - (rs.b.amount ?? 0)).toBeCloseTo(2080, 2)
		expect(rs.a.oldestAribaAt).not.toBeNull()

		const sm = d("short_or_missing")
		expect((sm.a.count ?? 0) - (sm.b.count ?? 0)).toBe(2)
		expect((sm.a.missing ?? 0) - (sm.b.missing ?? 0)).toBe(1)
		expect((sm.a.amount ?? 0) - (sm.b.amount ?? 0)).toBeCloseTo(37.45, 2)

		// Exposure: sold to PBCC (batch sent), Claro has not paid. The two
		// paid invoices drop out; 2000 + 1000 + 1000 remain.
		const ex = d("pbcc_exposure")
		expect((ex.a.count ?? 0) - (ex.b.count ?? 0)).toBe(3)
		expect((ex.a.amount ?? 0) - (ex.b.amount ?? 0)).toBeCloseTo(4000, 2)
		expect(ex.a.oldestDays).toBeGreaterThanOrEqual(94)
		expect(ex.a.averageDays).not.toBeNull()
	})

	it("gives every tile a link and returns the week strip", async () => {
		const home = await loadComptrollerHome(NOW)
		expect(home.tiles.map((x) => x.key)).toEqual([
			"payroll_to_pay",
			"installer_week",
			"ja_waiting_po",
			"ready_or_sent_not_paid",
			"short_or_missing",
			"pbcc_exposure",
			"retention_year",
		])
		for (const x of home.tiles) expect(x.href).toMatch(/^\/comptroller/)
		expect(home.week).toHaveLength(4)
		expect(tile(home, "payroll_to_pay").href).toBe("/comptroller/to-pay")
		expect(tile(home, "installer_week").parts).toHaveLength(4)
	})
})
