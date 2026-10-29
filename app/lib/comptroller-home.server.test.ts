import { afterAll, describe, expect, it, vi } from "vitest"
import { loadComptrollerHome } from "~/lib/comptroller-home.server"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	seedContractorAccount,
	seedSweptInvoice,
	seedUser,
} from "~/test/helpers"

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
		// The new invoice is 94 days old; older rows in a shared DB may exceed it.
		expect(po.a.oldestDays).toBe(Math.max(po.b.oldestDays ?? 0, 94))

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
		expect(ex.a.oldestDays).toBe(Math.max(ex.b.oldestDays ?? 0, 94))
		expect(ex.a.averageDays).toBeGreaterThan(0)
		expect(Number.isNaN(ex.a.averageDays)).toBe(false)
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
		expect(
			tile(home, "installer_week").parts?.map((p) => [p.key, p.href]),
		).toEqual([
			["waiting_ewit", "/comptroller/installers"],
			["not_batched", "/comptroller/installers/batches"],
			["batch_sent_this_week", "/comptroller/installers/batches"],
			["installers_to_tick", "/comptroller/installers/pay"],
		])
		const base = "/comptroller/installers/claro/invoices"
		expect(tile(home, "ja_waiting_po").href).toBe(`${base}?stage=no_po`)
		expect(tile(home, "ready_or_sent_not_paid").href).toBe(
			`${base}?stage=ariba_open`,
		)
		expect(tile(home, "short_or_missing").href).toBe(`${base}?stage=short`)
		expect(tile(home, "pbcc_exposure").href).toBe(`${base}?stage=exposure`)
	})

	it("installer_week parts reflect an open batch and waiting EWIT invoices", async () => {
		// Other test files add and remove EWIT invoices in parallel, so a
		// before/after difference of the global count is not reliable. Instead,
		// capture the filter the tile counts with and check it against our own
		// invoice: counted while its batch is open, not once the batch is sent.
		const carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const open = t.track(
			"ewitBatch",
			await db.ewitBatch.create({ data: { createdById: carmen.id } }),
		)
		const inv = t.track(
			"ewitInvoice",
			await db.ewitInvoice.create({
				data: {
					number: `JA${9900000 + Math.floor(Math.random() * 90000)}`,
					invoiceDate: daysAgo(1),
					total: 10,
					filePath: "/files/x.pdf",
					createdById: carmen.id,
					batchId: open.id,
				},
			}),
		)
		const count = vi.spyOn(db.ewitInvoice, "count")
		const after = await loadComptrollerHome(NOW)
		const idx = count.mock.calls.findIndex((c) =>
			JSON.stringify(c[0]?.where ?? {}).includes('"batchId":null'),
		)
		expect(idx).toBeGreaterThanOrEqual(0)
		const where = count.mock.calls[idx][0]?.where ?? {}
		const tileCount = await count.mock.results[idx].value
		count.mockRestore()

		const part = (h: typeof after, key: string) =>
			tile(h, "installer_week").parts?.find((p) => p.key === key)?.count ?? 0
		expect(part(after, "not_batched")).toBe(tileCount)
		const ours = () =>
			db.ewitInvoice.count({ where: { AND: [where, { id: inv.id }] } })
		expect(await ours()).toBe(1)
		await db.ewitBatch.update({
			where: { id: open.id },
			data: { closedAt: NOW, sentAt: NOW },
		})
		expect(await ours()).toBe(0)
		expect([0, 1]).toContain(part(after, "batch_sent_this_week"))
	})

	it("retention counts sent, non-reversed runs this year and skips reversed ones", async () => {
		const before = tile(await loadComptrollerHome(NOW), "retention_year")
		const carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const account = t.track("contractorAccount", await seedContractorAccount())
		const kept = await seedSweptInvoice({
			generatedById: carmen.id,
			contractorAccountId: account.id,
			grossPayable: 1000,
			retentionAmount: 37.5,
			netPayable: 600,
		})
		const reversed = await seedSweptInvoice({
			generatedById: carmen.id,
			contractorAccountId: account.id,
			grossPayable: 1000,
			retentionAmount: 99.99,
			netPayable: 600,
		})
		t.track("payrollRun", kept.run)
		t.track("jafInvoice", kept.invoice)
		t.track("payrollRun", reversed.run)
		t.track("jafInvoice", reversed.invoice)
		await db.payrollRun.update({
			where: { id: kept.run.id },
			data: { sentAt: NOW },
		})
		await db.payrollRun.update({
			where: { id: reversed.run.id },
			data: { sentAt: NOW, reversedAt: NOW },
		})
		const after = tile(await loadComptrollerHome(NOW), "retention_year")
		expect((after.amount ?? 0) - (before.amount ?? 0)).toBeCloseTo(37.5, 2)
		expect((after.count ?? 0) - (before.count ?? 0)).toBe(1)
	})
})
