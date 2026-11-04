import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"

// Integration test against the shadow Postgres DB: what Finance's verify page
// tells Lissette about a returned, resent or never-released packet (S4).

vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))

import { requireRole } from "~/lib/permissions.server"
import { loader } from "./_app.finance.verify.$id"

const tracker = makeTracker()
afterAll(() => tracker.cleanup())

const entry = {
	note: "Aviso lists the wrong pole",
	byUserId: "u",
	createdAt: "2026-10-26T14:00:00.000Z",
}

async function load(
	overrides: Parameters<typeof seedFinanceableInvoice>[0],
	notes?: unknown,
	docData: Record<string, unknown> = {},
) {
	const finance = tracker.track("user", await seedUser({ role: "FINANCE" }))
	vi.mocked(requireRole).mockResolvedValue({ user: finance } as never)
	const doc = tracker.track(
		"jafInvoice",
		await seedFinanceableInvoice({ pbccRequestSentAt: null, ...overrides }),
	)
	if (notes || Object.keys(docData).length)
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: {
				...docData,
				...(notes ? { financeSendBackNotes: notes as never } : {}),
			},
		})
	return (await loader({
		request: new Request(`http://localhost/finance/verify/${doc.id}`),
		params: { id: doc.id },
		context: {},
	} as never)) as unknown as {
		returnState: {
			returned: boolean
			resent: boolean
			note: string | null
			createdAt: string | null
			resentAt: string | null
			resentPending: boolean
		}
		canVerify: boolean
		canSendBack: boolean
		notReleased: boolean
	}
}

describe("finance verify loader (S4)", () => {
	it("a released, never-returned packet can be verified and sent back", async () => {
		const r = await load({})
		expect(r.returnState.returned).toBe(false)
		expect(r.canVerify).toBe(true)
		expect(r.canSendBack).toBe(true)
	})

	it("a returned packet shows her note and cannot be verified; she may return it again", async () => {
		const r = await load({}, [entry])
		expect(r.returnState).toMatchObject({
			returned: true,
			resent: false,
			note: "Aviso lists the wrong pole",
			createdAt: "2026-10-26T14:00:00.000Z",
		})
		expect(r.canVerify).toBe(false)
		expect(r.canSendBack).toBe(true)
	})

	it("a resent packet says when, and is verifiable again", async () => {
		const r = await load({}, [
			{ ...entry, resentAt: "2026-10-28T10:00:00.000Z" },
		])
		expect(r.returnState).toMatchObject({
			returned: false,
			resent: true,
			resentAt: "2026-10-28T10:00:00.000Z",
		})
		expect(r.canVerify).toBe(true)
		expect(r.canSendBack).toBe(true)
	})

	it("once the resent packet is verified the Resent emphasis is gone, the history stays", async () => {
		const r = await load({}, [
			{ ...entry, resentAt: "2026-10-28T10:00:00.000Z" },
		])
		expect(r.returnState.resentPending).toBe(true)
		const v = await load(
			{},
			[{ ...entry, resentAt: "2026-10-28T10:00:00.000Z" }],
			{ financeVerifiedAt: new Date() },
		)
		expect(v.returnState.resent).toBe(true)
		expect(v.returnState.resentPending).toBe(false)
	})

	it("a job never released to Finance can neither be verified nor sent back", async () => {
		const r = await load({ releasedToFinanceAt: null })
		expect(r.notReleased).toBe(true)
		expect(r.canVerify).toBe(false)
		expect(r.canSendBack).toBe(false)
	})
})
