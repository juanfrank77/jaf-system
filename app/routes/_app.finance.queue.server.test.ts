import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader } from "./_app.finance.queue"

const t = makeTracker()
afterAll(() => t.cleanup())

const OLD = new Date("2000-01-01")

describe("step 1 packets in", () => {
	it("lists a released unaccepted packet and not an accepted one", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const packet = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				pbccRequestSentAt: null,
				releasedToFinanceAt: OLD,
			}),
		)
		await db.jafInvoice.update({
			where: { id: packet.id },
			data: { avisoNumber: `AV-${packet.controlNumber}` },
		})
		const accepted = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				pbccRequestSentAt: null,
				releasedToFinanceAt: OLD,
			}),
		)
		await db.jafInvoice.update({
			where: { id: accepted.id },
			data: { financeVerifiedAt: new Date() },
		})
		const result = await loader({
			request: new Request("http://localhost/finance/queue"),
			params: {},
			context: {},
		} as never)
		const ids = result.jobs.map((j: { id: string }) => j.id)
		expect(ids).toContain(packet.id)
		expect(ids).not.toContain(accepted.id)
		const row = result.jobs.find((j: { id: string }) => j.id === packet.id)
		expect(row?.docs.aviso).toBe(true)
		// Claro work-order PDF is not part of the Arm A packet; the docs are
		// the ones the supervisor release gate guarantees.
		expect(row?.docs).not.toHaveProperty("claroPdf")
		expect(row?.docs.preCert).toBe(false)
		expect(row?.docs.photos).toBe(false)
	})

	it("flags the work order PDF only when it is the packet under packets/", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		const packet = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				pbccRequestSentAt: null,
				releasedToFinanceAt: OLD,
			}),
		)
		const legacy = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				pbccRequestSentAt: null,
				releasedToFinanceAt: OLD,
			}),
		)
		await db.jafInvoice.update({
			where: { id: packet.id },
			data: { jafInvoicePdfPath: `/u/packets/${packet.id}-packet-1.pdf` },
		})
		await db.jafInvoice.update({
			where: { id: legacy.id },
			data: { jafInvoicePdfPath: `/u/jaf-invoices/${legacy.id}.pdf` },
		})
		const result = await loader({
			request: new Request("http://localhost/finance/queue"),
			params: {},
			context: {},
		} as never)
		const byId = (id: string) =>
			result.jobs.find((j: { id: string }) => j.id === id)
		expect(byId(packet.id)?.docs.jafInvoice).toBe(true)
		expect(byId(legacy.id)?.docs.jafInvoice).toBe(false)
	})

	describe("search, supervisor filter and amounts", () => {
		const call = (query: string) =>
			loader({
				request: new Request(`http://localhost/finance/queue${query}`),
				params: {},
				context: {},
			} as never)

		const line = (qty: number, unitPrice: number) => ({
			serviceCodeId: "sc",
			claroCode: "600X",
			name: "Remoción",
			unit: "EA",
			qty,
			unitPrice,
			lineAmount: qty * unitPrice,
		})

		it("shows the invoice total, IVU included, not the brigade's share", async () => {
			const finance = t.track("user", await seedUser({ role: "FINANCE" }))
			mocks.requireRole.mockResolvedValue({ user: finance })
			const tag = `AVAMT${Date.now()}`
			const packet = t.track(
				"jafInvoice",
				await seedFinanceableInvoice({
					pbccRequestSentAt: null,
					releasedToFinanceAt: OLD,
					avisoNumber: tag,
					jafInvoiceLines: [line(2, 100), line(1, 50)],
				}),
			)
			const result = await call(`?search=${tag}`)
			expect(result.jobs.map((j: { id: string }) => j.id)).toEqual([packet.id])
			// 250.00 + 11.5% IVU = 278.75
			expect(result.jobs[0].amount).toBe(278.75)
			expect(result.jobs[0].docs).not.toHaveProperty("account")
		})

		it("finds a packet by work order or Aviso number, ignoring case", async () => {
			const finance = t.track("user", await seedUser({ role: "FINANCE" }))
			mocks.requireRole.mockResolvedValue({ user: finance })
			const tag = `AVSRCH${Date.now()}`
			const packet = t.track(
				"jafInvoice",
				await seedFinanceableInvoice({
					pbccRequestSentAt: null,
					releasedToFinanceAt: OLD,
					avisoNumber: tag,
				}),
			)
			for (const q of [tag.toLowerCase(), packet.controlNumber]) {
				const result = await call(`?search=${encodeURIComponent(q)}`)
				expect(result.jobs.map((j: { id: string }) => j.id)).toContain(
					packet.id,
				)
			}
			const none = await call("?search=NOPE-NOT-A-NUMBER")
			expect(none.jobs).toEqual([])
			expect(none.startId).toBeNull()
		})

		it("filters by supervisor and Start reviewing opens the oldest match", async () => {
			const finance = t.track("user", await seedUser({ role: "FINANCE" }))
			mocks.requireRole.mockResolvedValue({ user: finance })
			const sup = t.track("user", await seedUser({ role: "SUPERVISOR" }))
			const other = t.track("user", await seedUser({ role: "SUPERVISOR" }))
			const older = t.track(
				"jafInvoice",
				await seedFinanceableInvoice({
					supervisorId: sup.id,
					pbccRequestSentAt: null,
					releasedToFinanceAt: new Date("1999-01-01"),
				}),
			)
			t.track(
				"jafInvoice",
				await seedFinanceableInvoice({
					supervisorId: sup.id,
					pbccRequestSentAt: null,
					releasedToFinanceAt: new Date("1999-06-01"),
				}),
			)
			const theirs = t.track(
				"jafInvoice",
				await seedFinanceableInvoice({
					supervisorId: other.id,
					pbccRequestSentAt: null,
					releasedToFinanceAt: new Date("1998-01-01"),
				}),
			)
			const result = await call(`?supervisor=${sup.id}`)
			const ids = result.jobs.map((j: { id: string }) => j.id)
			expect(ids).toEqual([older.id, expect.any(String)])
			expect(ids).not.toContain(theirs.id)
			expect(result.startId).toBe(older.id)
			expect(result.supervisors.map((s: { id: string }) => s.id)).toEqual(
				expect.arrayContaining([sup.id, other.id]),
			)
		})
	})
})
