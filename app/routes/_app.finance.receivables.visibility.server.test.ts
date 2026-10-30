import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"

// Integration test against the shadow Postgres DB: the receivables list is
// gated on release-to-Finance, with the legacy PBCC_ADVANCE exception.

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
	requireSession: vi.fn(),
}))

import { requireRole } from "~/lib/permissions.server"
import { loader } from "./_app.finance.receivables"

const { track, cleanup } = makeTracker()

describe("finance receivables — release gate (integration)", () => {
	let releasedId: string
	let unreleasedId: string
	let legacyId: string

	beforeAll(async () => {
		const finance = track("user", await seedUser({ role: "FINANCE" }))
		vi.mocked(requireRole).mockResolvedValue({ user: finance } as any)
		const supervisor = track("user", await seedUser({ role: "SUPERVISOR" }))
		const mk = async (releasedToFinanceAt?: null) =>
			track(
				"jafInvoice",
				await seedFinanceableInvoice({
					status: "CLARO_UPLOADED",
					supervisorId: supervisor.id,
					...(releasedToFinanceAt === null ? { releasedToFinanceAt } : {}),
				}),
			)
		releasedId = (await mk()).id
		unreleasedId = (await mk(null)).id
		legacyId = (await mk(null)).id
		track(
			"paymentRecord",
			await db.paymentRecord.create({
				data: {
					jobId: legacyId,
					type: "PBCC_ADVANCE",
					amount: 10,
					date: new Date(),
					recordedById: finance.id,
				},
			}),
		)
	})

	afterAll(cleanup)

	it("lists released and legacy-advance docs but not un-released ones", async () => {
		const result = (await loader({
			request: new Request("http://localhost/finance/receivables"),
			params: {},
		} as any)) as { rows: { id: string }[] }
		const ids = result.rows.map((r) => r.id)
		expect(ids).toContain(releasedId)
		expect(ids).toContain(legacyId)
		expect(ids).not.toContain(unreleasedId)
	})
})

describe("finance receivables: returned packets (integration)", () => {
	const note = [
		{ note: "Fix", byUserId: "u", createdAt: "2026-10-26T14:00:00.000Z" },
	]
	it("hides a returned packet, unless it already carries a payment record", async () => {
		const finance = track("user", await seedUser({ role: "FINANCE" }))
		vi.mocked(requireRole).mockResolvedValue({ user: finance } as any)
		const supervisor = track("user", await seedUser({ role: "SUPERVISOR" }))
		const mk = async () =>
			track(
				"jafInvoice",
				await seedFinanceableInvoice({
					status: "CLARO_UPLOADED",
					supervisorId: supervisor.id,
					// At Packets in (no LC request yet): where a return is live.
					pbccRequestSentAt: null,
				}),
			)
		const bare = await mk()
		const paid = await mk()
		for (const d of [bare, paid])
			await db.jafInvoice.update({
				where: { id: d.id },
				data: { financeSendBackNotes: note },
			})
		track(
			"paymentRecord",
			await db.paymentRecord.create({
				data: {
					jobId: paid.id,
					type: "PBCC_ADVANCE",
					amount: 10,
					date: new Date(),
					recordedById: finance.id,
				},
			}),
		)
		const result = (await loader({
			request: new Request("http://localhost/finance/receivables"),
			params: {},
		} as any)) as { rows: { id: string }[] }
		const ids = result.rows.map((r) => r.id)
		expect(ids).not.toContain(bare.id)
		expect(ids).toContain(paid.id)
	})
})
