import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	seedMaterial,
	seedUser,
	seedWarehouse,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader } from "./_app.warehouse.movements"

const t = makeTracker()
afterAll(() => t.cleanup())

function req(url: string, cookie?: string) {
	return new Request(url, { headers: cookie ? { cookie } : undefined })
}

describe("movement log loader", () => {
	it("lists the selected warehouse's movements newest first, with actor and material", async () => {
		const wh = t.track("warehouse", await seedWarehouse())
		const other = t.track("warehouse", await seedWarehouse())
		const user = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		await db.warehouseAssignment.create({
			data: { userId: user.id, warehouseId: wh.id, isLead: true },
		})
		const code = t.track("serviceCode", await seedMaterial())
		const mk = async (warehouseId: string, qty: number, at: Date) =>
			t.track(
				"stockMovement",
				await db.stockMovement.create({
					data: {
						kind: "BULK",
						warehouseId,
						serviceCodeId: code.id,
						qty,
						type: "RECEIVE",
						byUserId: user.id,
						at,
					},
				}),
			)
		await mk(wh.id, 1, new Date("2026-01-01"))
		await mk(wh.id, 2, new Date("2026-02-01"))
		await mk(other.id, 99, new Date("2026-03-01"))
		mocks.requireRole.mockResolvedValue({ user })

		const data = await loader({
			request: req("http://x/warehouse/movements", `wh=${wh.id}`),
			params: {},
			context: {},
		} as never)

		expect(data.movements.map((m) => m.qty)).toEqual([2, 1])
		expect(data.movements[0].actor).toBe(user.name)
		expect(data.movements[0].material).toContain(code.claroCode)
		expect(data.paging).toMatchObject({ page: 1, pageCount: 1, total: 2 })
	})

	it("returns nothing when the user has no warehouse assignment", async () => {
		const worker = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		mocks.requireRole.mockResolvedValue({ user: worker })
		const data = await loader({
			request: req("http://x/warehouse/movements"),
			params: {},
			context: {},
		} as never)
		expect(data.movements).toEqual([])
	})
})
