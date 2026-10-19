import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	db: {
		jafInvoice: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
		user: { findUniqueOrThrow: vi.fn() },
		serviceCode: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
		auditTrail: { create: vi.fn() },
		notification: { create: vi.fn() },
		$transaction: vi.fn(),
	},
	requireRole: vi.fn(),
	isTerminalStatus: vi.fn(),
	computeFinanceStage: vi.fn(),
	fetchInvoiceTotalContext: vi.fn(),
	invoiceTotalUsed: vi.fn(),
	checkAmountTolerance: vi.fn(),
	isMissingAvisoPdf: vi.fn(),
	sendInternalEmail: vi.fn(),
}))

vi.mock("~/lib/db.server", () => ({ db: mocks.db }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/permissions", () => ({
	isTerminalStatus: mocks.isTerminalStatus,
}))
vi.mock("~/lib/finance-pipeline.server", async (importOriginal) => ({
	billableMaterials: (
		await importOriginal<typeof import("~/lib/finance-pipeline.server")>()
	).billableMaterials,
	computeFinanceStage: mocks.computeFinanceStage,
	fetchInvoiceTotalContext: mocks.fetchInvoiceTotalContext,
	invoiceTotalUsed: mocks.invoiceTotalUsed,
	checkAmountTolerance: mocks.checkAmountTolerance,
	isMissingAvisoPdf: mocks.isMissingAvisoPdf,
	FINANCEABLE_STATUSES: ["SUPERVISOR_APPROVED", "CLARO_UPLOADED"],
}))
vi.mock("~/lib/email.server", () => ({
	sendInternalEmail: mocks.sendInternalEmail,
}))

import { action, loader } from "./_app.finance.verify.$id"

const requestWith = (entries: Record<string, string>) => {
	const form = new FormData()
	for (const [key, value] of Object.entries(entries)) form.set(key, value)
	return new Request("http://localhost/finance/verify/job-1", {
		method: "POST",
		body: form,
	})
}

const baseDoc = () => ({
	id: "job-1",
	controlNumber: "JAF-1",
	status: "SUPERVISOR_APPROVED",
	supervisorId: "sup-1",
	poLinks: [],
	paymentRecords: [],
	financeSendBackNotes: [],
	supervisor: { email: "sup@example.com" },
})

describe("Finance verify action guards", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.isTerminalStatus.mockReturnValue(false)
		mocks.requireRole.mockResolvedValue({
			user: { id: "finance-1", role: "FINANCE" },
		})
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue(baseDoc())
		mocks.computeFinanceStage.mockReturnValue("TO_VERIFY")
		mocks.fetchInvoiceTotalContext.mockResolvedValue({
			serviceCodes: [],
			codeMap: {},
			ivuRate: 0.115,
			tolerance: 0.01,
		})
		mocks.invoiceTotalUsed.mockReturnValue(100)
		mocks.checkAmountTolerance.mockReturnValue({
			withinTolerance: true,
			difference: 0,
		})
		mocks.isMissingAvisoPdf.mockReturnValue(false)
		mocks.db.$transaction.mockResolvedValue(undefined)
	})

	it("rejects terminal LC jobs in the action", async () => {
		mocks.isTerminalStatus.mockReturnValue(true)
		const result = await action({
			request: requestWith({ intent: "verify", avisoAmount: "100" }),
			params: { id: "job-1" },
		} as any)
		expect(result).toEqual({
			errorKey: "finance_verify.errors.terminal_status",
		})
		expect(mocks.db.jafInvoice.findUniqueOrThrow).toHaveBeenCalled()
	})

	it("rejects unknown intents before loading or mutating a job", async () => {
		const result = await action({
			request: requestWith({ intent: "bogus" }),
			params: { id: "job-1" },
		} as any)
		expect(result).toEqual({
			errorKey: "finance_verify.errors.unknown_intent",
		})
		expect(mocks.db.jafInvoice.findUniqueOrThrow).toHaveBeenCalled()
	})

	it("rejects an invalid stage before mutating a job", async () => {
		mocks.computeFinanceStage.mockReturnValue("PBCC_REQUEST_PENDING")
		const result = await action({
			request: requestWith({ intent: "verify", avisoAmount: "100" }),
			params: { id: "job-1" },
		} as any)
		expect(result).toEqual({
			errorKey: "finance_verify.errors.invalid_stage",
		})
		expect(mocks.db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("records a successful verification", async () => {
		const result = await action({
			request: requestWith({
				intent: "verify",
				avisoAmount: "100",
				note: "ok",
			}),
			params: { id: "job-1" },
		} as any).catch((r: any) => r)
		expect(result.status).toBe(302)
		expect(mocks.db.jafInvoice.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ financeVerifiedAt: expect.any(Date) }),
			}),
		)
	})
})

describe("verify pre-fill from supervisor capture", () => {
	it("verify uses the stored aviso line total when the supervisor captured lines", async () => {
		mocks.db.$transaction.mockResolvedValue([])
		mocks.requireRole.mockResolvedValue({
			user: { id: "fin-1", role: "FINANCE" },
		})
		mocks.isTerminalStatus.mockReturnValue(false)
		mocks.computeFinanceStage.mockReturnValue("TO_VERIFY")
		mocks.isMissingAvisoPdf.mockReturnValue(false)
		const fixture = {
			...baseDoc(),
			avisoNumber: "10353961",
			claroPdfPath: "/x/claro.pdf",
			avisoLineTotal: "239.34",
			avisoMatchedAt: new Date(),
			jafInvoiceLineTotal: "239.34",
		}
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue(fixture)
		const form = new FormData()
		form.set("intent", "verify") // no avisoAmount typed
		const res = await action({
			request: requestWith({ intent: "verify" }),
			params: { id: "job-1" },
		} as any).catch((r) => r)
		expect(res.status).toBe(302)
		expect(mocks.db.auditTrail.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					diffJson: expect.objectContaining({
						avisoAmount: 239.34,
						invoiceTotal: 239.34,
						source: "SUPERVISOR_CAPTURE",
					}),
				}),
			}),
		)
	})
})

describe("Finance verify loader: brigade's stock and the two PDFs", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.requireRole.mockResolvedValue({
			user: { id: "finance-1", role: "FINANCE" },
		})
		mocks.computeFinanceStage.mockReturnValue("TO_VERIFY")
		mocks.invoiceTotalUsed.mockReturnValue(100)
		mocks.fetchInvoiceTotalContext.mockResolvedValue({
			serviceCodes: [
				{ id: "m1", claroCode: "1005803", name: "Drop cable", unit: "FT" },
			],
			codeMap: {},
			ivuRate: 0.115,
			tolerance: 0.01,
		})
	})

	const load = () =>
		loader({
			request: new Request("http://localhost/finance/verify/job-1"),
			params: { id: "job-1" },
		} as any)

	it("lists BRIGADE_STOCK rows as tracked and links the priced invoice once sent", async () => {
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue({
			...baseDoc(),
			jafInvoiceGeneratedAt: new Date("2026-10-01T12:00:00Z"),
			jafInvoicePdfPath: "/uploads/packets/job-1-packet-1.pdf",
			fieldMaterials: [
				{ serviceCodeId: "m1", used: 6, returned: 4, source: "WAREHOUSE" },
				{ serviceCodeId: "m1", used: 4, returned: 0, source: "BRIGADE_STOCK" },
			],
		})
		mocks.db.serviceCode.findMany.mockResolvedValue([
			{ id: "m1", claroCode: "1005803", name: "Drop cable", unit: "FT" },
		])
		const data = await load()
		expect(data.brigadeStock).toEqual([
			{
				serviceCodeId: "m1",
				claroCode: "1005803",
				name: "Drop cable",
				qty: 4,
				unit: "FT",
			},
		])
		// Inactive codes too: the tracked list looks its codes up by id.
		expect(mocks.db.serviceCode.findMany).toHaveBeenCalledWith({
			where: { id: { in: ["m1"] } },
		})
		expect(data.pricedInvoiceHref).toBe("/finance/verify/job-1/invoice.pdf")
		expect(data.packetHref).toMatch(/job-1-packet-1\.pdf$/)
	})

	it("has no tracked list for warehouse-only use and no priced link before the send", async () => {
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue({
			...baseDoc(),
			jafInvoiceGeneratedAt: null,
			jafInvoicePdfPath: null,
			fieldMaterials: [
				{ serviceCodeId: "m1", used: 6, returned: 4, source: "WAREHOUSE" },
			],
		})
		const data = await load()
		expect(data.brigadeStock).toEqual([])
		expect(data.pricedInvoiceHref).toBeNull()
		expect(data.packetHref).toBeNull()
		expect(data.legacyPricedHref).toBeNull()
	})

	it("labels a legacy priced file as the legacy priced invoice, not the packet", async () => {
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue({
			...baseDoc(),
			jafInvoiceGeneratedAt: new Date("2026-09-01T12:00:00Z"),
			jafInvoicePdfPath: "/uploads/jaf-invoices/job-1-jaf-invoice.pdf",
		})
		const data = await load()
		expect(data.packetHref).toBeNull()
		expect(data.legacyPricedHref).toBe(
			"/files/jaf-invoices/job-1-jaf-invoice.pdf",
		)
	})
})

describe("Finance verify loader: the listed materials are the billed ones", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.requireRole.mockResolvedValue({
			user: { id: "finance-1", role: "FINANCE" },
		})
		mocks.computeFinanceStage.mockReturnValue("TO_VERIFY")
		mocks.invoiceTotalUsed.mockReturnValue(100)
		mocks.fetchInvoiceTotalContext.mockResolvedValue({
			serviceCodes: [],
			codeMap: {},
			ivuRate: 0.115,
			tolerance: 0.01,
		})
	})

	const load = (doc: Record<string, unknown>) => {
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue({
			...baseDoc(),
			materialsTaken: [{ serviceCodeId: "m1", qty: 10 }],
			...doc,
		})
		return loader({
			request: new Request("http://localhost/finance/verify/job-1"),
			params: { id: "job-1" },
		} as any)
	}

	it("6 from the warehouse + 4 brigade's stock lists 6, even on a pre-ruling row", async () => {
		const fieldMaterials = [
			{ serviceCodeId: "m1", used: 6, returned: 4, source: "WAREHOUSE" },
			{ serviceCodeId: "m1", used: 4, returned: 0, source: "BRIGADE_STOCK" },
		]
		for (const qty of [6, 10]) {
			const data = await load({
				fieldMaterials,
				materialsUsed: [{ serviceCodeId: "m1", qty }],
			})
			expect(data.materials).toEqual([{ serviceCodeId: "m1", qty: 6 }])
		}
	})

	it("brigade's-stock-only use lists nothing, not the signed-out pickup", async () => {
		const data = await load({
			materialsUsed: [],
			fieldMaterials: [
				{ serviceCodeId: "m1", used: 0, returned: 10, source: "WAREHOUSE" },
				{ serviceCodeId: "m2", used: 3, returned: 0, source: "BRIGADE_STOCK" },
			],
		})
		expect(data.materials).toEqual([])
	})

	it("a legacy job without the Field table lists the pickup when nothing was used", async () => {
		const data = await load({ materialsUsed: null, fieldMaterials: null })
		expect(data.materials).toEqual([{ serviceCodeId: "m1", qty: 10 }])
	})
})
