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

describe("returned packets (S4)", () => {
	const note = (resentAt?: string) => [
		{
			note: "Aviso lists the wrong pole",
			byUserId: "someone",
			createdAt: "2026-10-26T14:00:00.000Z",
			...(resentAt && { resentAt }),
		},
	]
	async function seedPacket(notes: unknown, released = OLD) {
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				pbccRequestSentAt: null,
				releasedToFinanceAt: released,
			}),
		)
		if (notes)
			await db.jafInvoice.update({
				where: { id: doc.id },
				data: { financeSendBackNotes: notes as never },
			})
		return doc
	}
	const load = async (query = "") => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: finance })
		return (await loader({
			request: new Request(`http://localhost/finance/queue${query}`),
			params: {},
			context: {},
		} as never)) as unknown as {
			jobs: { id: string; resent?: boolean; returned?: boolean }[]
			returnedCount: number
			view: string
		}
	}

	it("takes a returned packet out of All, counts it, and lists it under Returned", async () => {
		const plain = await seedPacket(null)
		const returned = await seedPacket(note())
		const all = await load()
		const ids = all.jobs.map((j) => j.id)
		expect(ids).toContain(plain.id)
		expect(ids).not.toContain(returned.id)
		expect(all.returnedCount).toBeGreaterThanOrEqual(1)
		const only = await load("?stage=returned")
		expect(only.view).toBe("returned")
		expect(only.jobs.map((j) => j.id)).toContain(returned.id)
		expect(only.jobs.map((j) => j.id)).not.toContain(plain.id)
		expect(only.jobs.find((j) => j.id === returned.id)?.returned).toBe(true)
	})

	it("brings a resent packet back into All, flagged Resent and ahead of the older ones", async () => {
		const plain = await seedPacket(null)
		const resent = await seedPacket(
			note("2026-10-28T10:00:00.000Z"),
			new Date(),
		)
		const all = await load()
		const ids = all.jobs.map((j) => j.id)
		expect(ids.indexOf(resent.id)).toBeGreaterThanOrEqual(0)
		expect(ids.indexOf(resent.id)).toBeLessThan(ids.indexOf(plain.id))
		expect(all.jobs.find((j) => j.id === resent.id)?.resent).toBe(true)
		expect(all.jobs.find((j) => j.id === plain.id)?.resent).toBeFalsy()
	})

	it("lists the most recently resent packet first", async () => {
		const older = await seedPacket(note("2026-10-27T10:00:00.000Z"), new Date())
		const newer = await seedPacket(note("2026-10-29T10:00:00.000Z"), new Date())
		const plain = await seedPacket(null)
		const ids = (await load()).jobs.map((j) => j.id)
		expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id))
		expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(plain.id))
	})
})
