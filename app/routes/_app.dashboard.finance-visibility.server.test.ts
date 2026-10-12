import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

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
