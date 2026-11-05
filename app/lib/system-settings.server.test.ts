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
	getInvoiceSignature,
	getIvuRate,
	getLcPbccAdvanceRate,
	setAgingAlertDays,
	setInvoiceSignature,
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

	it("getInvoiceSignature is null until a signature is stored", async () => {
		vi.mocked(db.systemSetting.findUnique).mockResolvedValue(null)
		await expect(getInvoiceSignature()).resolves.toBeNull()
		expect(db.systemSetting.findUnique).toHaveBeenCalledWith({
			where: { key: "invoice_signature" },
		})
	})

	it("setInvoiceSignature keeps a PNG as a data URI in the settings, not in the uploads", async () => {
		vi.mocked(db.systemSetting.upsert).mockResolvedValue({} as any)
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		await setInvoiceSignature(png, "admin-1")
		const value = `data:image/png;base64,${Buffer.from(png).toString("base64")}`
		expect(db.systemSetting.upsert).toHaveBeenCalledWith({
			where: { key: "invoice_signature" },
			update: { value, updatedById: "admin-1" },
			create: { key: "invoice_signature", value, updatedById: "admin-1" },
		})
	})

	it("setInvoiceSignature refuses anything but a PNG or JPEG", async () => {
		vi.mocked(db.systemSetting.upsert).mockClear()
		await expect(
			setInvoiceSignature(new TextEncoder().encode("<svg></svg>"), "admin-1"),
		).rejects.toThrow("signature_not_image")
		expect(db.systemSetting.upsert).not.toHaveBeenCalled()
	})

	it("setInvoiceSignature refuses a file over 1 MB", async () => {
		const big = new Uint8Array(1024 * 1024 + 1)
		big.set([0xff, 0xd8, 0xff])
		await expect(setInvoiceSignature(big, "admin-1")).rejects.toThrow(
			"signature_too_big",
		)
	})
})
