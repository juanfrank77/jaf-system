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
	getLcPbccAdvanceRate: vi.fn(),
	setLcPbccAdvanceRate: vi.fn(),
	getInvoiceSignature: vi.fn(),
	setInvoiceSignature: vi.fn(),
	getBankContractNumber: vi.fn().mockResolvedValue("17-xxx"),
	setBankContractNumber: vi.fn(),
	getPbccEmail: vi.fn().mockResolvedValue(null),
	getInvoiceCodes: vi.fn().mockResolvedValue({ dept: "", costCenter: "" }),
	setInvoiceCodes: vi.fn(),
	getJobNumberFirst: vi.fn().mockResolvedValue(1),
	setJobNumberFirst: vi.fn(),
	setPbccEmail: vi.fn(),
	getPayDayWeekday: vi.fn().mockResolvedValue(4),
	setPayDayWeekday: vi.fn(),
}))

import { requireRole } from "~/lib/permissions.server"
import {
	getAgingAlertDays,
	getAvisoAmountTolerance,
	getIvuRate,
	getLcPbccAdvanceRate,
	setAgingAlertDays,
	setAvisoAmountTolerance,
	setInvoiceSignature,
	setIvuRate,
	setLcPbccAdvanceRate,
	setPbccEmail,
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
		vi.mocked(getLcPbccAdvanceRate).mockResolvedValue(0.8)

		const result = await loader({
			request: new Request("http://localhost/admin/settings"),
			params: {},
		} as any)

		expect(result).toMatchObject({
			ivuRate: 0.115,
			agingAlertDays: 30,
			avisoAmountTolerance: 0.01,
			lcPbccAdvanceRate: 0.8,
			payDayWeekday: 4,
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
	it("updates LC/PBCC advance rate", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		const form = new FormData()
		form.set("intent", "lc_pbcc_advance")
		form.set("lc_pbcc_advance_rate", "0.75")
		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)
		expect(setLcPbccAdvanceRate).toHaveBeenCalledWith(0.75, "admin-1")
		expect(result).toEqual({ successLcPbccAdvance: true })
	})

	it("rejects an invalid LC/PBCC advance rate", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		const form = new FormData()
		form.set("intent", "lc_pbcc_advance")
		form.set("lc_pbcc_advance_rate", "1.1")
		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)
		expect(result).toEqual({
			errorKey: "admin_settings.errors.invalid_lc_pbcc_rate",
		})
		expect(setLcPbccAdvanceRate).not.toHaveBeenCalled()
	})

	it("saves all four PBCC addresses, comma separated", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		const form = new FormData()
		form.set("intent", "bank_prefix")
		form.set("pbcc_email", "hs@x.com; lh@x.com, ah@x.com dd@x.com")
		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)
		expect(setPbccEmail).toHaveBeenCalledWith(
			"hs@x.com, lh@x.com, ah@x.com, dd@x.com",
			"admin-1",
		)
		expect(result).toEqual({ successBankPrefix: true })
	})

	it("refuses the addresses when any one of them is not an email", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(setPbccEmail).mockClear()
		const form = new FormData()
		form.set("intent", "bank_prefix")
		form.set("pbcc_email", "hs@x.com, nope")
		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)
		expect(result).toEqual({
			errorKey: "admin_settings.errors.invalid_pbcc_email",
		})
		expect(setPbccEmail).not.toHaveBeenCalled()
	})

	it("stores an uploaded signature image", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		const form = new FormData()
		form.set("intent", "signature")
		form.set(
			"signature",
			new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "s.png", {
				type: "image/png",
			}),
		)
		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)
		expect(setInvoiceSignature).toHaveBeenCalledWith(
			new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
			"admin-1",
		)
		expect(result).toEqual({ successSignature: true })
	})

	it("says so when the signature file is not an image", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1" },
			session: {},
		} as any)
		vi.mocked(setInvoiceSignature).mockRejectedValueOnce(
			new Error("signature_not_image"),
		)
		const form = new FormData()
		form.set("intent", "signature")
		form.set("signature", new File(["x"], "s.txt"))
		const result = await action({
			request: formRequest(form),
			params: {},
		} as any)
		expect(result).toEqual({
			errorKey: "admin_settings.errors.signature_not_image",
		})
	})
})
