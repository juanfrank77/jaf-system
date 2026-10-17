import { describe, expect, it } from "vitest"
import {
	WAREHOUSE_QUEUE_LABEL_KEY,
	WAREHOUSE_QUEUES,
	warehouseQueueHref,
} from "./warehouse-queues"

describe("warehouse queues", () => {
	it("lists the three owned steps in rail order", () => {
		expect(WAREHOUSE_QUEUES).toEqual(["prep", "release", "returns"])
	})

	it("gives each step its own page, not an anchor", () => {
		expect(WAREHOUSE_QUEUES.map(warehouseQueueHref)).toEqual([
			"/warehouse/prep",
			"/warehouse/release",
			"/warehouse/returns",
		])
	})

	it("labels each step with the existing nav label", () => {
		expect(WAREHOUSE_QUEUE_LABEL_KEY).toEqual({
			prep: "app_shell.nav.warehouse_prep",
			release: "app_shell.nav.warehouse_pickup",
			returns: "app_shell.nav.warehouse_returns",
		})
	})
})
