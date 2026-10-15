import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: { jafInvoice: { count: vi.fn() } },
}))

import { db } from "~/lib/db.server"
import { Prisma } from "../../generated/prisma/client"
import {
	countWarehouseQueues,
	warehouseQueueWhere,
} from "./warehouse-queues.server"

describe("warehouseQueueWhere", () => {
	it("prep is CREATED, release is PREPPED", () => {
		expect(warehouseQueueWhere("prep")).toEqual({ status: "CREATED" })
		expect(warehouseQueueWhere("release")).toEqual({ status: "PREPPED" })
	})

	it("returns is signed/field-updated work with no returned-materials record", () => {
		expect(warehouseQueueWhere("returns")).toEqual({
			status: { in: ["SIGNED", "FIELD_UPDATED"] },
			materialsReturned: { equals: Prisma.DbNull },
		})
	})
})

describe("countWarehouseQueues", () => {
	beforeEach(() => vi.clearAllMocks())

	it("counts each step with its own where", async () => {
		vi.mocked(db.jafInvoice.count)
			.mockResolvedValueOnce(3)
			.mockResolvedValueOnce(2)
			.mockResolvedValueOnce(4)
		expect(await countWarehouseQueues()).toEqual({
			prep: 3,
			release: 2,
			returns: 4,
		})
		expect(db.jafInvoice.count).toHaveBeenNthCalledWith(1, {
			where: { status: "CREATED" },
		})
		expect(db.jafInvoice.count).toHaveBeenNthCalledWith(2, {
			where: { status: "PREPPED" },
		})
	})
})
