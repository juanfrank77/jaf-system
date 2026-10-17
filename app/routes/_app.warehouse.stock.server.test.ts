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

import { loader } from "./_app.warehouse.stock"

const t = makeTracker()
afterAll(() => t.cleanup())

async function seedTwoWarehouses() {
	const lead = t.track("user", await seedUser({ role: "WAREHOUSE" }))
	const guaynabo = t.track("warehouse", await seedWarehouse())
	const arecibo = t.track("warehouse", await seedWarehouse())
	await db.warehouseAssignment.createMany({
		data: [
			{ userId: lead.id, warehouseId: guaynabo.id, isLead: true },
			{ userId: lead.id, warehouseId: arecibo.id, isLead: true },
		],
	})
	return { lead, guaynabo, arecibo }
}

function req(url: string, cookie?: string) {
	return new Request(url, {
		headers: cookie ? { cookie } : undefined,
	})
}

describe("stock & audit loader", () => {
	// A slower first-connection round trip to the shared dev DB can push this
	// past the default 5s timeout when it's the first test in the file.
	it("scopes to the selected warehouse and omits the derived figure for no-factor rows", async () => {
		const { lead, guaynabo, arecibo } = await seedTwoWarehouses()
		mocks.requireRole.mockResolvedValue({ user: lead })
		const noFactor = t.track(
			"serviceCode",
			await seedMaterial({
				countUnit: "ROLLOS",
				stockUnit: "FT",
				conversionFactor: null,
			}),
		)
		const other = t.track("serviceCode", await seedMaterial())
		t.track(
			"stockMovement",
			await db.stockMovement.create({
				data: {
					kind: "BULK",
					warehouseId: guaynabo.id,
					serviceCodeId: noFactor.id,
					qty: 4,
					type: "STARTING_BALANCE",
					byUserId: lead.id,
				},
			}),
		)
		t.track(
			"stockMovement",
			await db.stockMovement.create({
				data: {
					kind: "BULK",
					warehouseId: arecibo.id,
					serviceCodeId: other.id,
					qty: 9,
					type: "STARTING_BALANCE",
					byUserId: lead.id,
				},
			}),
		)

		const data = await loader({
			request: req("http://x/warehouse/stock", `wh=${guaynabo.id}`),
			params: {},
			context: {},
		} as never)

		expect(data.bulk.map((b) => b.serviceCodeId)).toContain(noFactor.id)
		expect(data.bulk.map((b) => b.serviceCodeId)).not.toContain(other.id)
		expect(
			data.bulk.find((b) => b.serviceCodeId === noFactor.id)?.derivedStockQty,
		).toBeNull()
		expect(data.selectedId).toBe(guaynabo.id)
		expect(data.warehouses.map((w) => w.id).sort()).toEqual(
			[guaynabo.id, arecibo.id].sort(),
		)
	}, 15000)

	it("marks isLead true for an ADMIN regardless of assignment", async () => {
		const admin = t.track("user", await seedUser({ role: "ADMIN" }))
		const wh = t.track("warehouse", await seedWarehouse())
		mocks.requireRole.mockResolvedValue({ user: admin })

		const data = await loader({
			request: req("http://x/warehouse/stock", `wh=${wh.id}`),
			params: {},
			context: {},
		} as never)

		expect(data.selectedId).toBe(wh.id)
		expect(data.isLead).toBe(true)
	})

	it("marks isLead false for a non-lead warehouse worker", async () => {
		const worker = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		const wh = t.track("warehouse", await seedWarehouse())
		await db.warehouseAssignment.create({
			data: { userId: worker.id, warehouseId: wh.id, isLead: false },
		})
		mocks.requireRole.mockResolvedValue({ user: worker })

		const data = await loader({
			request: req("http://x/warehouse/stock", `wh=${wh.id}`),
			params: {},
			context: {},
		} as never)

		expect(data.isLead).toBe(false)
	})

	it("returns an empty scope when the user has no warehouse assignment", async () => {
		const worker = t.track("user", await seedUser({ role: "WAREHOUSE" }))
		mocks.requireRole.mockResolvedValue({ user: worker })

		const data = await loader({
			request: req("http://x/warehouse/stock"),
			params: {},
			context: {},
		} as never)

		expect(data.selectedId).toBeUndefined()
		expect(data.bulk).toEqual([])
	})
})
