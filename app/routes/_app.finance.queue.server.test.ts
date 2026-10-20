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
})
