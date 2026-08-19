import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(),
}))

vi.mock("~/lib/system-settings.server", () => ({
	getIvuRate: vi.fn(),
	setIvuRate: vi.fn(),
	getAgingAlertDays: vi.fn(),
	setAgingAlertDays: vi.fn(),
	getAvisoAmountTolerance: vi.fn(),
	setAvisoAmountTolerance: vi.fn(),
}))

import { requireRole } from "~/lib/permissions.server"
import {
	getAgingAlertDays,
	getAvisoAmountTolerance,
	getIvuRate,
	setAgingAlertDays,
	setAvisoAmountTolerance,
	setIvuRate,
} from "~/lib/system-settings.server"
import { action, loader } from "./_app.admin.settings"

function formRequest(form: FormData) {
	return new Request("http://localhost/admin/settings", {
		method: "POST",
		body: form,
	})
}

describe("GET /admin/settings", () => {
	beforeEach(() => vi.clearAllMocks())

	it("loads IVU rate and aging alert days", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(getIvuRate).mockResolvedValue(0.115)
		vi.mocked(getAgingAlertDays).mockResolvedValue(30)
		vi.mocked(getAvisoAmountTolerance).mockResolvedValue(0.01)

		const result = await loader({
			request: new Request("http://localhost/admin/settings"),
			params: {},
		} as any)

		expect(result).toEqual({
			ivuRate: 0.115,
			agingAlertDays: 30,
			avisoAmountTolerance: 0.01,
		})
	})
})

describe("POST /admin/settings", () => {
	beforeEach(() => vi.clearAllMocks())

	it("updates IVU rate", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)

		const form = new FormData()
		form.set("intent", "ivu")
		form.set("ivu_rate", "0.105")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)

		expect(setIvuRate).toHaveBeenCalledWith(0.105, "admin-1")
		expect(result).toEqual({ success: true })
	})

	it("rejects invalid IVU rate", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)

		const form = new FormData()
		form.set("intent", "ivu")
		form.set("ivu_rate", "1.5")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)

		expect(result).toEqual({ errorKey: "admin_settings.errors.invalid_rate" })
		expect(setIvuRate).not.toHaveBeenCalled()
	})

	it("updates aging alert days", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)

		const form = new FormData()
		form.set("intent", "aging")
		form.set("aging_alert_days", "45")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)

		expect(setAgingAlertDays).toHaveBeenCalledWith(45, "admin-1")
		expect(result).toEqual({ successAging: true })
	})

	it("rejects invalid aging alert days", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)

		const form = new FormData()
		form.set("intent", "aging")
		form.set("aging_alert_days", "0")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)

		expect(result).toEqual({
			errorKey: "admin_settings.errors.invalid_aging_days",
		})
		expect(setAgingAlertDays).not.toHaveBeenCalled()
	})

	it("updates aviso amount tolerance", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)

		const form = new FormData()
		form.set("intent", "tolerance")
		form.set("aviso_amount_tolerance", "0.05")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)

		expect(setAvisoAmountTolerance).toHaveBeenCalledWith(0.05, "admin-1")
		expect(result).toEqual({ successTolerance: true })
	})

	it("rejects invalid aviso amount tolerance", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)

		const form = new FormData()
		form.set("intent", "tolerance")
		form.set("aviso_amount_tolerance", "-1")

		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)

		expect(result).toEqual({
			errorKey: "admin_settings.errors.invalid_tolerance",
		})
		expect(setAvisoAmountTolerance).not.toHaveBeenCalled()
	})
})
