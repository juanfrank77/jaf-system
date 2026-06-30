import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./db.server", () => ({
	db: {
		systemSetting: {
			findUnique: vi.fn(),
			upsert: vi.fn(),
		},
	},
}))

import { db } from "./db.server"
import { getIvuRate, setIvuRate } from "./system-settings.server"

describe("system settings", () => {
	beforeEach(() => vi.clearAllMocks())

	it("getIvuRate returns parsed float from db", async () => {
		vi.mocked(db.systemSetting.findUnique).mockResolvedValue({
			value: "0.115",
		} as any)
		const rate = await getIvuRate()
		expect(rate).toBe(0.115)
	})

	it("getIvuRate returns default 0.115 when setting missing", async () => {
		vi.mocked(db.systemSetting.findUnique).mockResolvedValue(null)
		const rate = await getIvuRate()
		expect(rate).toBe(0.115)
	})
})
