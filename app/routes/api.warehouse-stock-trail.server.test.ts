import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedMaterial,
	seedUser,
	seedWarehouse,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader } from "./api.warehouse-stock-trail"

const t = makeTracker()
afterAll(() => t.cleanup())

type TrailRow = { type: string; job: string | null; note: string | null }

// Review finding G: the trail resolved only `refCompletionId`, but every bulk
// warehouse movement this branch writes (RELEASE/RETURN) sets `refDocId` — so
// the "job" column was permanently null for exactly the rows it was built for.
describe("warehouse stock trail", () => {
	it("resolves refDocId to the doc's control number for the job column", async () => {
		const wh = t.track("warehouse", await seedWarehouse())
		const user = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		const supervisor = t.track("user", await seedUser({ role: "SUPERVISOR" }))
		const sc = t.track("serviceCode", await seedMaterial())
		const controlNumber = runToken("JAF")
		const doc = t.track(
			"jafInvoice",
			await db.jafInvoice.create({
				data: {
					controlNumber,
					status: "SIGNED",
					jobType: "INSTALL",
					jobAddressEstimated: "1 Test St",
					estimatedMaterials: [],
					assignedCrewIds: [],
					supervisorId: supervisor.id,
					warehouseId: wh.id,
				},
			}),
		)
		t.track(
			"stockMovement",
			await db.stockMovement.create({
				data: {
					kind: "BULK",
					type: "RELEASE",
					warehouseId: wh.id,
					serviceCodeId: sc.id,
					qty: -10,
					byUserId: user.id,
					refDocId: doc.id,
				},
			}),
		)
		t.track(
			"stockMovement",
			await db.stockMovement.create({
				data: {
					kind: "BULK",
					type: "ADJUST",
					warehouseId: wh.id,
					serviceCodeId: sc.id,
					qty: 2,
					note: "cycle count",
					byUserId: user.id,
				},
			}),
		)
		mocks.requireRole.mockResolvedValue({ user })

		const res = (await loader({
			request: new Request(
				`http://x/api/warehouse-stock-trail?warehouseId=${wh.id}&serviceCodeId=${sc.id}`,
			),
			params: {},
			context: {},
		} as never)) as Response
		const { trail } = (await res.json()) as { trail: TrailRow[] }

		const release = trail.find((r) => r.type === "RELEASE")
		expect(release?.job).toBe(controlNumber)
		// A movement with no job reference at all still falls back to its note.
		const adjust = trail.find((r) => r.type === "ADJUST")
		expect(adjust?.job).toBeNull()
		expect(adjust?.note).toBe("cycle count")
	})
})
