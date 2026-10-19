import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		jafInvoice: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
		auditTrail: { create: vi.fn(), findFirst: vi.fn() },
		notification: { create: vi.fn(), createMany: vi.fn() },
		user: { findMany: vi.fn(), findUnique: vi.fn() },
		photo: { findMany: vi.fn() },
		brigade: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
		preCertSheet: {
			findFirst: vi.fn(),
			findMany: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(),
		},
		$transaction: vi.fn(async (ops: any) =>
			typeof ops === "function" ? ops({}) : Promise.all(ops),
		),
	},
}))
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/service-codes.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/service-codes.server")>()),
	getActiveServiceCodes: vi.fn(),
}))
vi.mock("~/lib/system-settings.server", () => ({
	getIvuRate: vi.fn(),
	getAvisoAmountTolerance: vi.fn(),
}))
vi.mock("~/lib/uploads.server", () => ({
	saveBuffer: vi.fn(),
	saveUpload: vi.fn(),
	// Default: every Photo row's file loads; individual tests override.
	photosThatLoad: vi.fn(async (_docId: string, photos: unknown[]) => photos),
}))
vi.mock("~/lib/pdf/jaf-invoice.server", () => ({
	generateJafInvoicePdf: vi.fn(),
}))
vi.mock("~/lib/pdf/pre-cert-sheet.server", () => ({
	generatePreCertSheetPdf: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { generateJafInvoicePdf } from "~/lib/pdf/jaf-invoice.server"
import { generatePreCertSheetPdf } from "~/lib/pdf/pre-cert-sheet.server"
import { requireRole } from "~/lib/permissions.server"
import { getActiveServiceCodes } from "~/lib/service-codes.server"
import {
	getAvisoAmountTolerance,
	getIvuRate,
} from "~/lib/system-settings.server"
import { photosThatLoad, saveBuffer, saveUpload } from "~/lib/uploads.server"
import { action, loader } from "./_app.docs.$id_.review"

const CATALOG = [
	{
		id: "c1",
		claroCode: "34006301",
		name: "TRANSFER ATTCH DE POSTESMC",
		accountCode: "610",
		unit: "EA",
		unitPrice: "42.3430",
		contractorFactor: "0.65",
		priceListRevision: "REV 2023-04-21",
	},
	{
		id: "c2",
		claroCode: "34007030",
		name: "REMOCION DE LINEA BAJANTEMO",
		accountCode: "6102",
		unit: "EA",
		unitPrice: "13.8115",
		contractorFactor: "0.65",
		priceListRevision: "REV 2023-04-21",
	},
]
const INSTALLED = [
	{
		serviceCodeId: "c1",
		claroCode: "34006301",
		accountCode: "610",
		name: "TRANSFER ATTCH DE POSTESMC",
		qty: 5,
	},
	{
		serviceCodeId: "c2",
		claroCode: "34007030",
		accountCode: "6102",
		name: "REMOCION DE LINEA BAJANTEMO",
		qty: 2,
	},
]

function post(form: FormData) {
	return new Request("http://localhost/docs/doc-1/review", {
		method: "POST",
		body: form,
	})
}
function intent(name: string, extra: Record<string, string> = {}) {
	const f = new FormData()
	f.set("intent", name)
	for (const [k, v] of Object.entries(extra)) f.set(k, v)
	return f
}

const approvedDoc = {
	id: "doc-1",
	controlNumber: "MAINT-260903-001",
	status: "SUPERVISOR_APPROVED",
	supervisorId: "sup-1",
	brigadeId: "b1",
	jobType: "Mantenimiento",
	jobDescription: "Transf. attachments",
	jobAddressEstimated: "CAM 906",
	jobAddressActual: "CAM 906, Yabucoa",
	avisoNumber: null,
	serviceLines: INSTALLED,
	installedServiceLines: INSTALLED,
	materialsUsed: [],
	materialsTaken: [],
	supervisorApprovedAt: new Date(),
	jafInvoiceGeneratedAt: null,
	jafInvoiceLines: null,
	jafInvoiceLineTotal: null,
	avisoDocPath: null,
	avisoLines: null,
	avisoLineTotal: null,
	avisoMatchedAt: null,
	contractorAccountCode: null,
	releasedToFinanceAt: null,
	fieldSubmittedAt: new Date("2026-08-26T20:12:00Z"),
	assignedCrewIds: ["crew-1"],
}

describe("supervisor scope guard", () => {
	const outOfAreaDoc = {
		...approvedDoc,
		supervisorId: "other-sup",
		brigade: { area: "SUR" },
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR", name: "Edgard Ocasio" },
			session: {},
		} as any)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["OESTE"],
		} as any)
	})

	it("blocks the loader for a Supervisor outside the doc's area", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			outOfAreaDoc as any,
		)
		await expect(
			loader({
				request: new Request("http://localhost/docs/doc-1/review"),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
	})

	it("blocks the action for a Supervisor outside the doc's area", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			outOfAreaDoc as any,
		)
		await expect(
			action({
				request: post(intent("send_back", { note: "test" })),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})
})

describe("review: generate_jaf_invoice", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR", name: "Edgard Ocasio" },
			session: {},
		} as any)
		vi.mocked(getActiveServiceCodes).mockResolvedValue(CATALOG as any)
		vi.mocked(getIvuRate).mockResolvedValue(0.115)
		vi.mocked(getAvisoAmountTolerance).mockResolvedValue(0.01)
		vi.mocked(generateJafInvoicePdf).mockResolvedValue(Buffer.from("pdf"))
		vi.mocked(saveBuffer).mockResolvedValue(
			"/uploads/jaf-invoices/doc-1-jaf-invoice.pdf",
		)
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b1",
			name: "JESUS MARTINEZ",
			code: "204",
		} as any)
	})

	it("prices installed service lines from the catalog and pins them on the doc", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			approvedDoc as any,
		)
		await action({
			request: post(intent("generate_jaf_invoice")),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		expect(db.jafInvoice.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					jafInvoiceLineTotal: 239.34,
					jafInvoicePdfPath: "/uploads/jaf-invoices/doc-1-jaf-invoice.pdf",
					jafInvoiceGeneratedAt: expect.any(Date),
					jafInvoiceLines: [
						expect.objectContaining({
							claroCode: "34006301",
							qty: 5,
							unitPrice: 42.343,
							lineAmount: 211.72,
						}),
						expect.objectContaining({
							claroCode: "34007030",
							qty: 2,
							unitPrice: 13.8115,
							lineAmount: 27.62,
						}),
					],
				}),
			}),
		)
		const pdfArgs = vi.mocked(generateJafInvoicePdf).mock.calls[0][0]
		// The Claro copy ties to the work order and carries no brigade pay.
		expect(pdfArgs).toMatchObject({
			controlNumber: "MAINT-260903-001",
			jobType: "Mantenimiento",
			brigadeName: "JESUS MARTINEZ",
		})
		expect(pdfArgs).not.toHaveProperty("contractorShare")
	})

	it("records who reviewed it and pins the invoice number in the audit trail", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			approvedDoc as any,
		)
		await action({
			request: post(intent("generate_jaf_invoice")),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		expect(db.auditTrail.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				userId: "sup-1",
				action: "JAF_INVOICE_GENERATED",
				diffJson: expect.objectContaining({
					reviewed: true,
					invoiceNumber: "M2026-MAINT-260903-001",
				}),
			}),
		})
	})

	it("locks the invoice once it is generated", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...approvedDoc,
			jafInvoiceGeneratedAt: new Date(),
		} as any)
		await expect(
			action({
				request: post(intent("generate_jaf_invoice")),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
		expect(generateJafInvoicePdf).not.toHaveBeenCalled()
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("refuses when there are no installed service lines", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...approvedDoc,
			installedServiceLines: [],
		} as any)
		const res = await action({
			request: post(intent("generate_jaf_invoice")),
			params: { id: "doc-1" },
		} as any)
		expect(res).toEqual({
			errorKey: "docs_review.errors.installed_lines_required",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("refuses regeneration after the aviso matched", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...approvedDoc,
			jafInvoiceGeneratedAt: new Date(),
			avisoMatchedAt: new Date(),
		} as any)
		const res = await action({
			request: post(intent("generate_jaf_invoice")),
			params: { id: "doc-1" },
		} as any).catch((r) => r)
		expect(res.status).toBe(302)
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})
})

describe("review: save_aviso", () => {
	const invoiced = {
		...approvedDoc,
		jafInvoiceGeneratedAt: new Date(),
		jafInvoiceLines: [
			{
				serviceCodeId: "c1",
				claroCode: "34006301",
				accountCode: "610",
				name: "T",
				unit: "EA",
				qty: 5,
				unitPrice: 42.343,
				lineAmount: 211.72,
			},
			{
				serviceCodeId: "c2",
				claroCode: "34007030",
				accountCode: "6102",
				name: "R",
				unit: "EA",
				qty: 2,
				unitPrice: 13.8115,
				lineAmount: 27.62,
			},
		],
		jafInvoiceLineTotal: 239.34,
	}
	const pdf = new File([Buffer.from("%PDF-1.4")], "aviso.pdf", {
		type: "application/pdf",
	})
	const matching = JSON.stringify([
		{ serviceCodeId: "c1", claroCode: "34006301", qty: 5, unitPrice: 42.343 },
		{ serviceCodeId: "c2", claroCode: "34007030", qty: 2, unitPrice: 13.8115 },
	])

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR", name: "E" },
			session: {},
		} as any)
		vi.mocked(getAvisoAmountTolerance).mockResolvedValue(0.01)
		vi.mocked(saveUpload).mockResolvedValue(
			"/uploads/aviso-docs/doc-1-aviso.pdf",
		)
		vi.mocked(db.user.findMany).mockResolvedValue([])
	})

	it("stores lines and stamps avisoMatchedAt + CLARO_UPLOADED when totals agree", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			invoiced as any,
		)
		const form = intent("save_aviso", {
			avisoNumber: "10353961",
			avisoLines: matching,
		})
		form.set("avisoPdf", pdf)
		await action({
			request: post(form),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		expect(db.jafInvoice.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					avisoNumber: "10353961",
					avisoDocPath: "/uploads/aviso-docs/doc-1-aviso.pdf",
					avisoLineTotal: 239.34,
					avisoMatchedAt: expect.any(Date),
					status: "CLARO_UPLOADED",
					claroUploadedAt: expect.any(Date),
				}),
			}),
		)
	})

	it("stores lines but does not stamp avisoMatchedAt on an amount mismatch", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			invoiced as any,
		)
		const form = intent("save_aviso", {
			avisoNumber: "10353961",
			avisoLines: JSON.stringify([
				{
					serviceCodeId: "c1",
					claroCode: "34006301",
					qty: 5,
					unitPrice: 2324.656,
				},
			]),
		})
		form.set("avisoPdf", pdf)
		const res = await action({
			request: post(form),
			params: { id: "doc-1" },
		} as any)
		expect(res).toMatchObject({
			errorKey: "docs_review.errors.aviso_amount_mismatch",
			invoiceTotal: 239.34,
			avisoTotal: 11623.28,
		})
		const data = vi.mocked(db.jafInvoice.update).mock.calls[0][0].data
		expect(data.avisoLineTotal).toBe(11623.28)
		expect(data.avisoMatchedAt).toBeUndefined()
		expect(data.status).toBeUndefined()
	})

	it("requires a note when a line quantity differs but the total matches", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			invoiced as any,
		)
		const form = intent("save_aviso", {
			avisoNumber: "10353961",
			// same total (239.34) but c2 charged as 3 × 9.2077 instead of 2 × 13.8115
			avisoLines: JSON.stringify([
				{
					serviceCodeId: "c1",
					claroCode: "34006301",
					qty: 5,
					unitPrice: 42.343,
				},
				{
					serviceCodeId: "c2",
					claroCode: "34007030",
					qty: 3,
					unitPrice: 9.2077,
				},
			]),
		})
		form.set("avisoPdf", pdf)
		const res = await action({
			request: post(form),
			params: { id: "doc-1" },
		} as any)
		expect(res).toMatchObject({
			errorKey: "docs_review.errors.aviso_line_note_required",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("logs a QUANTITY_DISCREPANCY audit that does not block when a note is given", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			invoiced as any,
		)
		const form = intent("save_aviso", {
			avisoNumber: "10353961",
			lineNote: "Claro merged two lines",
			// same total (239.34) but c2 charged as 3 × 9.2077 instead of 2 × 13.8115
			avisoLines: JSON.stringify([
				{
					serviceCodeId: "c1",
					claroCode: "34006301",
					qty: 5,
					unitPrice: 42.343,
				},
				{
					serviceCodeId: "c2",
					claroCode: "34007030",
					qty: 3,
					unitPrice: 9.2077,
				},
			]),
		})
		form.set("avisoPdf", pdf)
		await action({
			request: post(form),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		expect(db.auditTrail.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: "QUANTITY_DISCREPANCY",
					diffJson: expect.objectContaining({
						blocksFinance: false,
						note: "Claro merged two lines",
					}),
				}),
			}),
		)
	})

	it("merges duplicate service code rows before matching", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			invoiced as any,
		)
		const form = intent("save_aviso", {
			avisoNumber: "10353961",
			avisoLines: JSON.stringify([
				{
					serviceCodeId: "c1",
					claroCode: "34006301",
					qty: 4,
					unitPrice: 42.343,
				},
				{
					serviceCodeId: "c1",
					claroCode: "34006301",
					qty: 1,
					unitPrice: 42.343,
				},
				{
					serviceCodeId: "c2",
					claroCode: "34007030",
					qty: 2,
					unitPrice: 13.8115,
				},
			]),
		})
		form.set("avisoPdf", pdf)
		await action({
			request: post(form),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		const data = vi.mocked(db.jafInvoice.update).mock.calls[0][0].data
		expect(data.avisoLineTotal).toBe(239.34)
		expect(data.avisoMatchedAt).toBeDefined()
		expect(data.avisoLines).toHaveLength(2)
		expect(db.auditTrail.create).not.toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ action: "QUANTITY_DISCREPANCY" }),
			}),
		)
	})

	it("requires an invoice first", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			approvedDoc as any,
		)
		const res = await action({
			request: post(
				intent("save_aviso", { avisoNumber: "1", avisoLines: "[]" }),
			),
			params: { id: "doc-1" },
		} as any)
		expect(res).toEqual({ errorKey: "docs_review.errors.invoice_required" })
	})
})

describe("review: pre-cert sheet", () => {
	const matched = {
		...approvedDoc,
		status: "CLARO_UPLOADED",
		avisoNumber: "10353961",
		jafInvoiceGeneratedAt: new Date(),
		jafInvoiceLines: [],
		jafInvoiceLineTotal: 239.34,
		avisoDocPath: "/x/aviso.pdf",
		avisoLines: [
			{
				serviceCodeId: "c1",
				claroCode: "34006301",
				qty: 5,
				unitPrice: 42.343,
				lineAmount: 211.72,
			},
		],
		avisoLineTotal: 239.34,
		avisoMatchedAt: new Date(),
	}
	const sig = "data:image/png;base64,iVBORw0KGgo="

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR", name: "Edgard Ocasio" },
			session: {},
		} as any)
		vi.mocked(getActiveServiceCodes).mockResolvedValue(CATALOG as any)
		vi.mocked(generatePreCertSheetPdf).mockResolvedValue(Buffer.from("pdf"))
		vi.mocked(saveBuffer).mockResolvedValue("/uploads/precert/doc-1-v1.pdf")
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b1",
			name: "JESUS MARTINEZ",
			code: "204",
			leadName: "Jesús Martínez",
		} as any)
		vi.mocked(db.preCertSheet.create).mockResolvedValue({
			id: "sheet-1",
			version: 1,
		} as any)
	})

	it("generates version 1 from installed lines with pinned prices", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(matched as any)
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue(null)
		await action({
			request: post(intent("generate_precert")),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		expect(db.preCertSheet.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				docId: "doc-1",
				version: 1,
				avisoNumber: "10353961",
				certifiedAddress: "CAM 906, Yabucoa",
				title: "Transf. attachments",
				issuedOn: matched.fieldSubmittedAt,
				priceListRevision: "REV 2023-04-21",
				total: 239.34,
				issuedById: "sup-1",
				lines: [
					expect.objectContaining({
						claroCode: "34006301",
						installedQty: 5,
						certifiedQty: 5,
						unitPrice: 42.343,
						lineAmount: 211.72,
					}),
					expect.objectContaining({
						claroCode: "34007030",
						installedQty: 2,
						certifiedQty: 2,
						lineAmount: 27.62,
					}),
				],
			}),
		})
	})

	it("supersedes the previous version on regenerate", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(matched as any)
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue({
			id: "sheet-1",
			version: 1,
		} as any)
		await action({
			request: post(intent("generate_precert")),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		expect(db.preCertSheet.update).toHaveBeenCalledWith({
			where: { id: "sheet-1" },
			data: { supersededAt: expect.any(Date) },
		})
		expect(db.preCertSheet.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ version: 2 }),
		})
	})

	it("refuses generation before the aviso matched", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...matched,
			avisoMatchedAt: null,
		} as any)
		const res = await action({
			request: post(intent("generate_precert")),
			params: { id: "doc-1" },
		} as any)
		expect(res).toEqual({
			errorKey: "docs_review.errors.aviso_match_required",
		})
	})

	it("edits a certified quantity with a reason, before the supervisor signs", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(matched as any)
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue({
			id: "sheet-1",
			version: 1,
			sigSupervisorAt: null,
			avisoNumber: "10353961",
			issuedOn: new Date(),
			title: "T",
			certifiedAddress: "A",
			lines: [
				{
					serviceCodeId: "c1",
					claroCode: "34006301",
					accountCode: "610",
					description: "T",
					installedQty: 5,
					certifiedQty: 5,
					unit: "EA",
					unitPrice: 42.343,
					lineAmount: 211.72,
				},
			],
		} as any)
		await action({
			request: post(
				intent("edit_precert_qty", {
					serviceCodeId: "c1",
					certifiedQty: "4",
					reason: "Claro accepted 4",
				}),
			),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		expect(db.preCertSheet.update).toHaveBeenCalledWith({
			where: { id: "sheet-1" },
			data: expect.objectContaining({
				total: 169.37,
				lines: [
					expect.objectContaining({
						certifiedQty: 4,
						editReason: "Claro accepted 4",
						lineAmount: 169.37,
					}),
				],
			}),
		})
	})

	it("requires a reason to edit and refuses after the supervisor signed", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(matched as any)
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue({
			id: "sheet-1",
			sigSupervisorAt: null,
			lines: [],
		} as any)
		expect(
			await action({
				request: post(
					intent("edit_precert_qty", {
						serviceCodeId: "c1",
						certifiedQty: "4",
					}),
				),
				params: { id: "doc-1" },
			} as any),
		).toEqual({
			errorKey: "docs_review.errors.precert_edit_reason_required",
		})
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue({
			id: "sheet-1",
			sigSupervisorAt: new Date(),
			lines: [],
		} as any)
		expect(
			await action({
				request: post(
					intent("edit_precert_qty", {
						serviceCodeId: "c1",
						certifiedQty: "4",
						reason: "x",
					}),
				),
				params: { id: "doc-1" },
			} as any),
		).toEqual({ errorKey: "docs_review.errors.precert_locked" })
	})

	it("supervisor signature stores login identity", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(matched as any)
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue({
			id: "sheet-1",
			lines: [],
			avisoNumber: "1",
			issuedOn: new Date(),
			title: "T",
			certifiedAddress: "A",
			total: 1,
		} as any)
		await action({
			request: post(intent("sign_precert_supervisor", { signature: sig })),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		expect(db.preCertSheet.update).toHaveBeenCalledWith({
			where: { id: "sheet-1" },
			data: expect.objectContaining({
				sigSupervisorUserId: "sup-1",
				sigSupervisorName: "Edgard Ocasio",
				sigSupervisorImage: sig,
				sigSupervisorAt: expect.any(Date),
			}),
		})
	})

	it("sub-contractor signature copies the brigade code onto the job", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(matched as any)
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue({
			id: "sheet-1",
			lines: [],
			avisoNumber: "1",
			issuedOn: new Date(),
			title: "T",
			certifiedAddress: "A",
			total: 1,
		} as any)
		await action({
			request: post(
				intent("sign_precert_subcontractor", {
					signature: sig,
					signerName: "Jesús Martínez",
				}),
			),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		expect(db.preCertSheet.update).toHaveBeenCalledWith({
			where: { id: "sheet-1" },
			data: expect.objectContaining({
				sigSubcontractorCode: "204",
				sigSubcontractorName: "Jesús Martínez",
				sigSubcontractorImage: sig,
			}),
		})
		expect(db.jafInvoice.update).toHaveBeenCalledWith({
			where: { id: "doc-1" },
			data: { contractorAccountCode: "204" },
		})
	})

	it("sub-contractor signature saves a typed code when the brigade has none", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(matched as any)
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b1",
			name: "ZARIEL GARAY",
			code: null,
			leadName: "Zariel Garay",
		} as any)
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue({
			id: "sheet-1",
			lines: [],
			avisoNumber: "1",
			issuedOn: new Date(),
			title: "T",
			certifiedAddress: "A",
			total: 1,
		} as any)
		expect(
			await action({
				request: post(
					intent("sign_precert_subcontractor", {
						signature: sig,
						signerName: "Z",
					}),
				),
				params: { id: "doc-1" },
			} as any),
		).toEqual({ errorKey: "docs_review.errors.contractor_code_required" })
		await action({
			request: post(
				intent("sign_precert_subcontractor", {
					signature: sig,
					signerName: "Z",
					contractorCode: "274",
				}),
			),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		expect(db.brigade.update).toHaveBeenCalledWith({
			where: { id: "b1" },
			data: { code: "274" },
		})
		expect(db.jafInvoice.update).toHaveBeenCalledWith({
			where: { id: "doc-1" },
			data: { contractorAccountCode: "274" },
		})
	})

	it("claro signature accepts an uploaded scan instead of a drawing", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(matched as any)
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue({
			id: "sheet-1",
			lines: [],
			avisoNumber: "1",
			issuedOn: new Date(),
			title: "T",
			certifiedAddress: "A",
			total: 1,
		} as any)
		vi.mocked(saveUpload).mockResolvedValue(
			"/uploads/precert/doc-1-claro-scan.jpg",
		)
		const form = intent("sign_precert_claro", { signerName: "Sup. Claro" })
		form.set(
			"scan",
			new File([Buffer.from("jpg")], "scan.jpg", { type: "image/jpeg" }),
		)
		await action({
			request: post(form),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		expect(db.preCertSheet.update).toHaveBeenCalledWith({
			where: { id: "sheet-1" },
			data: expect.objectContaining({
				sigClaroName: "Sup. Claro",
				sigClaroScanPath: "/uploads/precert/doc-1-claro-scan.jpg",
				sigClaroAt: expect.any(Date),
			}),
		})
	})
})

describe("review: release_to_finance", () => {
	const ready = {
		...approvedDoc,
		status: "CLARO_UPLOADED",
		avisoNumber: "10353961",
		jafInvoiceGeneratedAt: new Date(),
		jafInvoiceLineTotal: 586.37,
		avisoDocPath: "/x/aviso.pdf",
		avisoLines: [
			{
				serviceCodeId: "c1",
				claroCode: "34006301",
				qty: 5,
				unitPrice: 42.343,
				lineAmount: 211.72,
			},
		],
		avisoMatchedAt: new Date(),
		contractorAccountCode: "204",
	}
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR", name: "E" },
			session: {},
		} as any)
		vi.mocked(db.user.findMany).mockResolvedValue([{ id: "fin-1" }] as any)
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b1",
			name: "JESUS MARTINEZ",
			code: "204",
			leadName: "Jesús Martínez",
		} as any)
		vi.mocked(db.photo.findMany).mockResolvedValue([
			{ tag: "BEFORE" },
			{ tag: "AFTER" },
		] as any)
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue({
			id: "s1",
			sigSupervisorAt: new Date(),
			sigSubcontractorAt: new Date(),
			sigClaroAt: null,
		} as any)
	})

	it("releases when all seven conditions hold and notifies Finance", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(ready as any)
		const res = await action({
			request: post(intent("release_to_finance")),
			params: { id: "doc-1" },
		} as any).catch((r) => r)
		expect(res.status).toBe(302)
		expect(db.jafInvoice.update).toHaveBeenCalledWith({
			where: { id: "doc-1" },
			data: {
				releasedToFinanceAt: expect.any(Date),
				releasedToFinanceById: "sup-1",
			},
		})
		expect(db.notification.create).toHaveBeenCalledWith({
			data: {
				userId: "fin-1",
				docId: "doc-1",
				message:
					"MAINT-260903-001 · Aviso 10353961 · Jesús Martínez · $586.37 — ready for payment request",
			},
		})
	})

	it("refuses when a photo is missing and reports which condition failed", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(ready as any)
		vi.mocked(db.photo.findMany).mockResolvedValue([{ tag: "BEFORE" }] as any)
		const res = await action({
			request: post(intent("release_to_finance")),
			params: { id: "doc-1" },
		} as any)
		expect(res).toMatchObject({
			errorKey: "docs_review.errors.release_blocked",
		})
		expect(
			res.conditions?.find((c: { key: string }) => c.key === "photos")?.ok,
		).toBe(false)
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("refuses when the photo rows exist but the files do not load", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(ready as any)
		vi.mocked(photosThatLoad).mockResolvedValueOnce([])
		const res = await action({
			request: post(intent("release_to_finance")),
			params: { id: "doc-1" },
		} as any)
		expect(
			res.conditions?.find((c: { key: string }) => c.key === "photos")?.ok,
		).toBe(false)
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("does not gate on the Claro signature", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(ready as any)
		const res = await action({
			request: post(intent("release_to_finance")),
			params: { id: "doc-1" },
		} as any).catch((r) => r)
		expect(res.status).toBe(302)
	})

	it("is idempotent", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...ready,
			releasedToFinanceAt: new Date(),
		} as any)
		await action({
			request: post(intent("release_to_finance")),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("send_to_finance no longer exists", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(ready as any)
		await action({
			request: post(intent("send_to_finance")),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		expect(db.auditTrail.create).not.toHaveBeenCalled()
		expect(db.notification.create).not.toHaveBeenCalled()
	})
})

describe("review loader: prices by role", () => {
	const generatedDoc = {
		...approvedDoc,
		supervisorId: "sup-1",
		brigade: { area: "OESTE" },
		jafInvoiceGeneratedAt: new Date("2026-10-14T15:10:00Z"),
		jafInvoiceLines: [
			{
				serviceCodeId: "c1",
				claroCode: "34006301",
				name: "TRANSFER",
				qty: 2,
				unitPrice: 42.343,
				lineAmount: 84.69,
			},
		],
		jafInvoiceLineTotal: 84.69,
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["OESTE"],
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			generatedDoc as any,
		)
		vi.mocked(db.photo.findMany).mockResolvedValue([])
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue(null)
		vi.mocked(db.brigade.findUnique).mockResolvedValue(null)
		vi.mocked(db.user.findMany).mockResolvedValue([])
		vi.mocked(getActiveServiceCodes).mockResolvedValue(CATALOG as any)
		vi.mocked(getIvuRate).mockResolvedValue(0.115)
		vi.mocked(getAvisoAmountTolerance).mockResolvedValue(0.01)
	})

	async function loadAs(role: string) {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role, name: "X" },
			session: {},
		} as any)
		return loader({
			request: new Request("http://localhost/docs/doc-1/review"),
			params: { id: "doc-1" },
		} as any)
	}

	it("gives a supervisor the invoice number but none of the money", async () => {
		const data = await loadAs("SUPERVISOR")
		expect(data.showPrices).toBe(false)
		expect(data.invoiceSummary).toBeNull()
		expect(data.invoiceNumber).toBeTruthy()
	})

	it("still gives Admin the totals", async () => {
		const data = await loadAs("ADMIN")
		expect(data.showPrices).toBe(true)
		expect(data.invoiceSummary).toMatchObject({ lineTotal: 84.69 })
	})
})

describe("review: back_to_approve", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR", name: "Edgard Ocasio" },
			session: {},
		} as any)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["OESTE"],
		} as any)
	})

	const doc = { ...approvedDoc, brigade: { area: "OESTE" } }

	it("needs a note", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(doc as any)
		const res = await action({
			request: post(intent("back_to_approve", { note: "  " })),
			params: { id: "doc-1" },
		} as any)
		expect(res).toEqual({ errorKey: "docs_review.errors.back_note_required" })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("reopens the Approve step with the note in the audit trail", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(doc as any)
		await expect(
			action({
				request: post(intent("back_to_approve", { note: "qty is off" })),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
		expect(db.jafInvoice.update).toHaveBeenCalledWith({
			where: { id: "doc-1" },
			data: { status: "FIELD_UPDATED", supervisorApprovedAt: null },
		})
		expect(db.auditTrail.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				action: "BACK_TO_APPROVE",
				diffJson: expect.objectContaining({ note: "qty is off" }),
			}),
		})
	})

	it("is not allowed once the invoice has been reviewed", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...doc,
			jafInvoiceGeneratedAt: new Date(),
		} as any)
		await expect(
			action({
				request: post(intent("back_to_approve", { note: "x" })),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})
})

describe("review: approve (Sign off)", () => {
	const SIG = "data:image/png;base64,iVBORw0KGgo="
	const fieldDone = {
		...approvedDoc,
		status: "FIELD_UPDATED",
		supervisorApprovedAt: null,
		brigade: { area: "OESTE" },
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR", name: "Edgard Ocasio" },
			session: {},
		} as any)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["OESTE"],
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			fieldDone as any,
		)
	})

	it.each([
		["missing", {}],
		["an empty pad", { completionSignature: "data:," }],
		["not an image", { completionSignature: "hello" }],
	])("refuses with the signature %s", async (_label, extra) => {
		const res = await action({
			request: post(intent("approve", extra as Record<string, string>)),
			params: { id: "doc-1" },
		} as any)
		expect(res).toEqual({ errorKey: "docs_review.errors.signature_required" })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("stores the signature, who signed and when, and moves to SUPERVISOR_APPROVED", async () => {
		await action({
			request: post(intent("approve", { completionSignature: SIG })),
			params: { id: "doc-1" },
		} as any).catch(() => {})
		const { data } = vi.mocked(db.jafInvoice.update).mock.calls[0][0] as any
		expect(data).toMatchObject({
			status: "SUPERVISOR_APPROVED",
			supervisorApprovedAt: expect.any(Date),
			completionSignature: SIG,
			completedById: "sup-1",
			completionSignedAt: expect.any(Date),
		})
		expect(db.auditTrail.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				action: "STATUS_CHANGED",
				diffJson: expect.objectContaining({
					status: { before: "FIELD_UPDATED", after: "SUPERVISOR_APPROVED" },
				}),
			}),
		})
	})

	it("an out-of-scope supervisor is refused", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...fieldDone,
			supervisorId: "other-sup",
			brigade: { area: "SUR" },
		} as any)
		await expect(
			action({
				request: post(intent("approve", { completionSignature: SIG })),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("cannot sign off twice", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...fieldDone,
			status: "SUPERVISOR_APPROVED",
			supervisorApprovedAt: new Date(),
		} as any)
		await expect(
			action({
				request: post(intent("approve", { completionSignature: SIG })),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})
})

describe("review: send_back to crew", () => {
	const fieldDone = {
		...approvedDoc,
		status: "FIELD_UPDATED",
		supervisorApprovedAt: null,
		brigade: { area: "OESTE" },
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["OESTE"],
		} as any)
		vi.mocked(db.user.findMany).mockResolvedValue([])
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			fieldDone as any,
		)
	})

	it("is not reachable for a SUPERVISOR (redirect, nothing written)", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR", name: "Edgard Ocasio" },
			session: {},
		} as any)
		await expect(
			action({
				request: post(intent("send_back", { note: "fix it" })),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
		expect(db.notification.create).not.toHaveBeenCalled()
	})
})
