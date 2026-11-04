import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"
import { Prisma } from "../../generated/prisma/client"

// Integration test against the shadow Postgres DB: Finance's dashboard only
// lists work orders released to Finance; Admin still sees everything.

vi.mock("~/lib/permissions.server", () => ({ requireSession: vi.fn() }))

import { requireSession } from "~/lib/permissions.server"
import { loader } from "./_app.dashboard"

const { track, cleanup } = makeTracker()

async function docsFor(userId: string, query = "") {
	vi.mocked(requireSession).mockResolvedValue({ user: { id: userId } } as any)
	const result = (await loader({
		request: new Request(`http://localhost/dashboard${query}`),
		params: {},
	} as any)) as { docs: { id: string }[] }
	return result.docs.map((d) => d.id)
}

describe("dashboard — Finance only sees released work orders (integration)", () => {
	const token = runToken("FINVIS").replace(/[^A-Za-z0-9]/g, "")
	let financeId: string
	let adminId: string
	let releasedId: string
	let unreleasedId: string

	beforeAll(async () => {
		financeId = track("user", await seedUser({ role: "FINANCE" })).id
		adminId = track("user", await seedUser({ role: "ADMIN" })).id
		const supervisor = track("user", await seedUser({ role: "SUPERVISOR" }))
		const released = track(
			"jafInvoice",
			await seedFinanceableInvoice({
				status: "CLARO_UPLOADED",
				supervisorId: supervisor.id,
				// At Packets in (no LC request yet): where a return is live.
				pbccRequestSentAt: null,
			}),
		)
		const unreleased = track(
			"jafInvoice",
			await seedFinanceableInvoice({
				status: "CLARO_UPLOADED",
				supervisorId: supervisor.id,
				releasedToFinanceAt: null,
			}),
		)
		for (const d of [released, unreleased]) {
			await db.jafInvoice.update({
				where: { id: d.id },
				data: {
					avisoNumber: `AV-${token}`,
					jobAddressEstimated: `Addr ${token}`,
				},
			})
		}
		releasedId = released.id
		unreleasedId = unreleased.id
	})

	afterAll(cleanup)

	it("FINANCE gets the released packet and not the un-released one", async () => {
		const ids = await docsFor(financeId)
		expect(ids).toContain(releasedId)
		expect(ids).not.toContain(unreleasedId)
	})

	it("FINANCE loses a returned packet from the list until it is resent; ADMIN keeps it", async () => {
		const note = {
			note: "Fix the Aviso",
			byUserId: "u",
			createdAt: "2026-10-26T14:00:00.000Z",
		}
		await db.jafInvoice.update({
			where: { id: releasedId },
			data: { financeSendBackNotes: [note] },
		})
		expect(await docsFor(financeId)).not.toContain(releasedId)
		expect(await docsFor(adminId)).toContain(releasedId)
		await db.jafInvoice.update({
			where: { id: releasedId },
			data: {
				financeSendBackNotes: [
					{ ...note, resentAt: "2026-10-28T10:00:00.000Z" },
				],
			},
		})
		expect(await docsFor(financeId)).toContain(releasedId)
		await db.jafInvoice.update({
			where: { id: releasedId },
			data: { financeSendBackNotes: Prisma.DbNull },
		})
	})

	it("the returned exclusion composes with a search filter instead of replacing it", async () => {
		await db.jafInvoice.update({
			where: { id: releasedId },
			data: {
				financeSendBackNotes: [
					{ note: "x", byUserId: "u", createdAt: "2026-10-26T14:00:00.000Z" },
				],
			},
		})
		// Search puts an OR in the where, then the exclusion joins under AND.
		expect(await docsFor(financeId, `?search=${token}`)).not.toContain(
			releasedId,
		)
		await db.jafInvoice.update({
			where: { id: releasedId },
			data: { financeSendBackNotes: Prisma.DbNull },
		})
		expect(await docsFor(financeId, `?search=${token}`)).toContain(releasedId)
	})

	it("ADMIN still sees both", async () => {
		const ids = await docsFor(adminId)
		expect(ids).toContain(releasedId)
		expect(ids).toContain(unreleasedId)
	})

	it("the gate survives a search that matches the un-released doc", async () => {
		const ids = await docsFor(financeId, `?search=${token}`)
		expect(ids).toContain(releasedId)
		expect(ids).not.toContain(unreleasedId)
		// sanity: the search really matches both for ADMIN
		const adminIds = await docsFor(adminId, `?search=${token}`)
		expect(adminIds).toEqual(expect.arrayContaining([releasedId, unreleasedId]))
	})

	it("the gate survives a status filter", async () => {
		const ids = await docsFor(financeId, "?status=CLARO_UPLOADED")
		expect(ids).toContain(releasedId)
		expect(ids).not.toContain(unreleasedId)
	})
})
