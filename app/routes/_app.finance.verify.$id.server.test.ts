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
	inboxNeighbors: vi.fn(),
	addToOpenBatch: vi.fn(),
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
vi.mock("~/lib/pbcc-batch.server", () => ({
	addToOpenBatch: mocks.addToOpenBatch,
}))
vi.mock("~/lib/finance-inbox.server", () => ({
	inboxNeighbors: mocks.inboxNeighbors,
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
	preCertSheets: [],
	photos: [],
})

// A packet with all four documents, and the four checks ticked.
const completeDoc = () => ({
	...baseDoc(),
	jafInvoiceGeneratedAt: new Date("2026-10-01T12:00:00Z"),
	jafInvoicePdfPath: "/uploads/packets/job-1-packet-1.pdf",
	avisoNumber: "10353961",
	avisoDocPath: "/uploads/aviso-docs/job-1-aviso.pdf",
	preCertSheets: [
		{
			pdfPath: "/uploads/precert/job-1-v1.pdf",
			sigSupervisorAt: new Date(),
			sigSubcontractorAt: new Date(),
		},
	],
	photos: [
		{
			localPath: "/uploads/photos/job-1/b.jpg",
			tag: "BEFORE",
			takenAt: new Date("2026-10-01"),
		},
		{
			localPath: "/uploads/photos/job-1/a.jpg",
			tag: "AFTER",
			takenAt: new Date("2026-10-02"),
		},
	],
})
const ALL_CHECKS = {
	check_invoice: "on",
	check_aviso: "on",
	check_photos: "on",
	check_precert: "on",
}

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
		mocks.inboxNeighbors.mockResolvedValue({
			total: 2,
			position: 1,
			prevId: null,
			nextId: "job-2",
		})
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

	it("verifies without an Aviso amount and records no amount check", async () => {
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue(completeDoc())
		const result = await action({
			request: requestWith({ intent: "verify", note: "ok", ...ALL_CHECKS }),
			params: { id: "job-1" },
		} as any).catch((r: any) => r)
		expect(result.status).toBe(302)
		// Accept & next: straight to the next packet in the Inbox.
		expect(result.headers.get("Location")).toBe("/finance/verify/job-2")
		expect(mocks.db.jafInvoice.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ financeVerifiedAt: expect.any(Date) }),
			}),
		)
		expect(mocks.db.auditTrail.create).toHaveBeenCalledWith({
			data: {
				docId: "job-1",
				userId: "finance-1",
				action: "FINANCE_VERIFIED",
				diffJson: { note: "ok", source: "STAMPED" },
			},
		})
		expect(mocks.checkAmountTolerance).not.toHaveBeenCalled()
	})

	it("never blocks on an Aviso amount, even a legacy stored mismatch", async () => {
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue({
			...completeDoc(),
			avisoLineTotal: "11623.28",
			jafInvoiceLineTotal: "586.37",
		})
		mocks.checkAmountTolerance.mockReturnValue({
			withinTolerance: false,
			difference: 11036.91,
		})
		for (const avisoAmount of [undefined, "abc", "-5", "999999"]) {
			const entries: Record<string, string> = {
				intent: "verify",
				...ALL_CHECKS,
			}
			if (avisoAmount !== undefined) entries.avisoAmount = avisoAmount
			const result = await action({
				request: requestWith(entries),
				params: { id: "job-1" },
			} as any).catch((r: any) => r)
			expect(result.status).toBe(302)
		}
		const diffs = mocks.db.auditTrail.create.mock.calls.map(
			(c: any) => c[0].data.diffJson,
		)
		for (const d of diffs) {
			expect(d).not.toHaveProperty("withinTolerance")
			expect(d).not.toHaveProperty("avisoAmount")
		}
	})
})

describe("Finance verify action: the accept gate and send back", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.isTerminalStatus.mockReturnValue(false)
		mocks.requireRole.mockResolvedValue({
			user: { id: "finance-1", role: "FINANCE" },
		})
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue(completeDoc())
		mocks.computeFinanceStage.mockReturnValue("TO_VERIFY")
		mocks.db.$transaction.mockResolvedValue(undefined)
		mocks.inboxNeighbors.mockResolvedValue({
			total: 1,
			position: 1,
			prevId: null,
			nextId: null,
		})
	})

	const run = (entries: Record<string, string>) =>
		action({ request: requestWith(entries), params: { id: "job-1" } } as any)

	it("refuses to accept unless all four checks are ticked", async () => {
		for (const missing of Object.keys(ALL_CHECKS)) {
			const { [missing as keyof typeof ALL_CHECKS]: _drop, ...rest } =
				ALL_CHECKS
			expect(await run({ intent: "verify", ...rest })).toEqual({
				errorKey: "finance_verify.errors.checks_required",
			})
		}
		expect(mocks.db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("refuses to accept a packet that is missing a document", async () => {
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue({
			...completeDoc(),
			preCertSheets: [],
		})
		expect(await run({ intent: "verify", ...ALL_CHECKS })).toEqual({
			errorKey: "finance_verify.errors.documents_missing",
		})
		expect(mocks.db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("puts an accepted packet in the open PBCC batch, and the accept stands if batching fails", async () => {
		mocks.addToOpenBatch.mockResolvedValueOnce({
			batchId: "b1",
			closedBatchIds: [],
		})
		await run({ intent: "verify", ...ALL_CHECKS }).catch((r: any) => r)
		expect(mocks.addToOpenBatch).toHaveBeenCalledWith({
			docId: "job-1",
			userId: "finance-1",
		})

		mocks.addToOpenBatch.mockRejectedValueOnce(new Error("pdf failed"))
		const quiet = vi.spyOn(console, "error").mockImplementation(() => {})
		const result = await run({ intent: "verify", ...ALL_CHECKS }).catch(
			(r: any) => r,
		)
		expect(result.status).toBe(302)
		quiet.mockRestore()
	})

	it("sends back without touching any batch", async () => {
		await run({ intent: "send_back", note: "wrong Aviso" }).catch((r: any) => r)
		expect(mocks.addToOpenBatch).not.toHaveBeenCalled()
	})

	it("goes back to the Inbox after the last packet", async () => {
		const result = await run({ intent: "verify", ...ALL_CHECKS }).catch(
			(r: any) => r,
		)
		expect(result.headers.get("Location")).toBe("/finance/queue")
	})

	it("sends back to the supervisor: releases nothing, keeps the reason, lands on the Inbox", async () => {
		const result = await run({
			intent: "send_back",
			note: "wrong Aviso",
		}).catch((r: any) => r)
		expect(result.status).toBe(302)
		expect(result.headers.get("Location")).toBe("/finance/queue")
		expect(mocks.db.jafInvoice.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					releasedToFinanceAt: null,
					releasedToFinanceById: null,
					financeVerifiedAt: null,
					financeSendBackNotes: [
						expect.objectContaining({
							note: "wrong Aviso",
							byUserId: "finance-1",
						}),
					],
				}),
			}),
		)
		expect(mocks.db.auditTrail.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				action: "FINANCE_SEND_BACK",
				diffJson: { note: "wrong Aviso", source: "STAMPED" },
			}),
		})
		expect(mocks.db.notification.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				userId: "sup-1",
				message: expect.stringContaining("wrong Aviso"),
			}),
		})
	})

	it("requires a reason to send back", async () => {
		expect(await run({ intent: "send_back", note: "  " })).toEqual({
			errorKey: "finance_verify.errors.note_required",
		})
		expect(mocks.db.jafInvoice.update).not.toHaveBeenCalled()
	})
})

describe("Finance verify loader: the invoice record's totals", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.requireRole.mockResolvedValue({
			user: { id: "finance-1", role: "FINANCE" },
		})
		mocks.computeFinanceStage.mockReturnValue("TO_VERIFY")
		mocks.fetchInvoiceTotalContext.mockResolvedValue({
			serviceCodes: [],
			codeMap: {},
			ivuRate: 0.115,
			tolerance: 0.01,
		})
		mocks.inboxNeighbors.mockResolvedValue({
			total: 3,
			position: 2,
			prevId: "job-0",
			nextId: "job-2",
		})
	})

	it("shows subtotal, IVU and total from the service lines, and the Inbox neighbours", async () => {
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue({
			...baseDoc(),
			jafInvoiceLines: [
				{
					serviceCodeId: "s1",
					claroCode: "600X",
					name: "Remoción",
					unit: "EA",
					qty: 2,
					unitPrice: 100,
					lineAmount: 200,
				},
				{
					serviceCodeId: "s2",
					claroCode: "610M",
					name: "Transfer",
					unit: "EA",
					qty: 1,
					unitPrice: 50,
					lineAmount: 50,
				},
			],
		})
		const data = await loader({
			request: new Request("http://localhost/finance/verify/job-1"),
			params: { id: "job-1" },
		} as any)
		expect(data.totals).toEqual({
			subtotal: 250,
			ivu4: 0,
			ivu115: 28.75,
			total: 278.75,
		})
		expect(
			data.invoiceLines.map((l: { ivuRate: number }) => l.ivuRate),
		).toEqual([0.115, 0.115])
		expect(data.neighbors).toMatchObject({ prevId: "job-0", nextId: "job-2" })
		expect(data).not.toHaveProperty("amount")
	})

	it("has empty totals for an invoice with no service lines", async () => {
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue(baseDoc())
		const data = await loader({
			request: new Request("http://localhost/finance/verify/job-1"),
			params: { id: "job-1" },
		} as any)
		expect(data.invoiceLines).toEqual([])
		expect(data.totals.total).toBe(0)
	})
})

describe("Finance verify loader: brigade's stock and the two PDFs", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.requireRole.mockResolvedValue({
			user: { id: "finance-1", role: "FINANCE" },
		})
		mocks.computeFinanceStage.mockReturnValue("TO_VERIFY")
		mocks.inboxNeighbors.mockResolvedValue({
			total: 1,
			position: 1,
			prevId: null,
			nextId: null,
		})
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

	it("lists the released packet's four documents with open-links", async () => {
		mocks.db.jafInvoice.findUniqueOrThrow.mockResolvedValue({
			...baseDoc(),
			jafInvoiceGeneratedAt: new Date("2026-10-01T12:00:00Z"),
			jafInvoicePdfPath: "/uploads/packets/job-1-packet-1.pdf",
			avisoNumber: "10353961",
			avisoDocPath: "/uploads/aviso-docs/job-1-aviso.pdf",
			preCertSheets: [
				{
					pdfPath: "/uploads/precert/job-1-v1.pdf",
					sigSupervisorAt: new Date(),
					sigSubcontractorAt: new Date(),
				},
			],
			photos: [
				{
					localPath: "/uploads/photos/job-1/b.jpg",
					tag: "BEFORE",
					takenAt: new Date("2026-10-01"),
				},
				{
					localPath: "/uploads/photos/job-1/a.jpg",
					tag: "AFTER",
					takenAt: new Date("2026-10-02"),
				},
			],
		})
		const data = await load()
		expect(data.packetDocs.map((d: { href: string | null }) => d.href)).toEqual(
			[
				"/files/packets/job-1-packet-1.pdf",
				"/files/aviso-docs/job-1-aviso.pdf",
				"/files/precert/job-1-v1.pdf",
				"/files/photos/job-1/b.jpg",
			],
		)
		// Only the latest live pre-cert sheet is read.
		expect(mocks.db.jafInvoice.findUniqueOrThrow).toHaveBeenCalledWith(
			expect.objectContaining({
				include: expect.objectContaining({
					preCertSheets: expect.objectContaining({
						where: { supersededAt: null },
						take: 1,
					}),
				}),
			}),
		)
		expect(data).not.toHaveProperty("prefilledAvisoAmount")
		expect(data).not.toHaveProperty("tolerance")
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
		mocks.inboxNeighbors.mockResolvedValue({
			total: 1,
			position: 1,
			prevId: null,
			nextId: null,
		})
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

describe("Finance verify loader: the Aviso discrepancy flag", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.requireRole.mockResolvedValue({
			user: { id: "finance-1", role: "FINANCE" },
		})
		mocks.computeFinanceStage.mockReturnValue("TO_VERIFY")
		mocks.inboxNeighbors.mockResolvedValue({
			total: 1,
			position: 1,
			prevId: null,
			nextId: null,
		})
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
			materialsUsed: [],
			fieldMaterials: [],
			...doc,
		})
		return loader({
			request: new Request("http://localhost/finance/verify/job-1"),
			params: { id: "job-1" },
		} as any)
	}

	it("returns the discrepancy with its note for a flagged job", async () => {
		const avisoDiscrepancy = {
			detectedAt: "2026-10-20T00:00:00.000Z",
			differences: [
				{ claroCode: "12345678", name: "Cable", workOrder: 4, aviso: 3 },
			],
			note: "Claro miscounted",
			noteAt: "2026-10-21T00:00:00.000Z",
			noteById: "sup-1",
		}
		const data = await load({ avisoDiscrepancy })
		expect(data.avisoDiscrepancy).toEqual(avisoDiscrepancy)
	})

	it("returns null when the job is not flagged", async () => {
		expect((await load({ avisoDiscrepancy: null })).avisoDiscrepancy).toBeNull()
		expect((await load({})).avisoDiscrepancy).toBeNull()
	})
})
