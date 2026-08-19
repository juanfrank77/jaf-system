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
import {
	getAgingAlertDays,
	getIvuRate,
	getLcPbccAdvanceRate,
	setAgingAlertDays,
	setIvuRate,
	setLcPbccAdvanceRate,
} from "./system-settings.server"

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

	it("setIvuRate upserts the setting", async () => {
		vi.mocked(db.systemSetting.upsert).mockResolvedValue({} as any)
		await setIvuRate(0.105, "admin-1")
		expect(db.systemSetting.upsert).toHaveBeenCalledWith({
			where: { key: "ivu_rate" },
			update: { value: "0.105", updatedById: "admin-1" },
			create: { key: "ivu_rate", value: "0.105", updatedById: "admin-1" },
		})
	})

	it("getAgingAlertDays returns parsed integer from db", async () => {
		vi.mocked(db.systemSetting.findUnique).mockResolvedValue({
			value: "45",
		} as any)
		const days = await getAgingAlertDays()
		expect(days).toBe(45)
	})

	it("getAgingAlertDays returns default 30 when setting missing", async () => {
		vi.mocked(db.systemSetting.findUnique).mockResolvedValue(null)
		const days = await getAgingAlertDays()
		expect(days).toBe(30)
	})

	it("getAgingAlertDays returns default 30 for invalid value", async () => {
		vi.mocked(db.systemSetting.findUnique).mockResolvedValue({
			value: "abc",
		} as any)
		const days = await getAgingAlertDays()
		expect(days).toBe(30)
	})

	it("setAgingAlertDays upserts the setting", async () => {
		vi.mocked(db.systemSetting.upsert).mockResolvedValue({} as any)
		await setAgingAlertDays(60, "admin-1")
		expect(db.systemSetting.upsert).toHaveBeenCalledWith({
			where: { key: "aging_alert_days" },
			update: { value: "60", updatedById: "admin-1" },
			create: { key: "aging_alert_days", value: "60", updatedById: "admin-1" },
		})
	})
	it("getLcPbccAdvanceRate defaults to 0.8 when missing", async () => {
		vi.mocked(db.systemSetting.findUnique).mockResolvedValue(null)
		await expect(getLcPbccAdvanceRate()).resolves.toBe(0.8)
	})

	it("getLcPbccAdvanceRate rejects invalid settings", async () => {
		vi.mocked(db.systemSetting.findUnique).mockResolvedValue({
			value: "1.2",
		} as any)
		await expect(getLcPbccAdvanceRate()).resolves.toBe(0.8)
	})

	it("setLcPbccAdvanceRate upserts the setting", async () => {
		vi.mocked(db.systemSetting.upsert).mockResolvedValue({} as any)
		await setLcPbccAdvanceRate(0.75, "admin-1")
		expect(db.systemSetting.upsert).toHaveBeenCalledWith({
			where: { key: "lc_pbcc_advance_rate" },
			update: { value: "0.75", updatedById: "admin-1" },
			create: {
				key: "lc_pbcc_advance_rate",
				value: "0.75",
				updatedById: "admin-1",
			},
		})
	})
})
