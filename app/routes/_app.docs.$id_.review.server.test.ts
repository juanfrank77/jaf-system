import { readFile } from "node:fs/promises"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => ({
	db: {
		jafInvoice: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
		auditTrail: { create: vi.fn(), findFirst: vi.fn() },
		notification: { create: vi.fn(), createMany: vi.fn() },
		user: { findMany: vi.fn(), findUnique: vi.fn() },
		photo: { findMany: vi.fn() },
		packetSend: { findMany: vi.fn(async () => []) },
		claroSupervisor: { findMany: vi.fn(async () => []), findUnique: vi.fn() },
		serviceCode: { findMany: vi.fn(async () => []) },
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
vi.mock("~/lib/pdf/pre-cert-sheet.server", () => ({
	generatePreCertSheetPdf: vi.fn(),
}))
vi.mock("~/lib/packet-send.server", () => ({ sendPacket: vi.fn() }))
// The real Aviso reader runs on the real sample PDF; the spy only lets one
// test feed it a print with a service split over two rows.
vi.mock("~/lib/aviso-pdf.server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("~/lib/aviso-pdf.server")>()
	return { ...actual, readAvisoPdf: vi.fn(actual.readAvisoPdf) }
})

import { readAvisoPdf } from "~/lib/aviso-pdf.server"
import { db } from "~/lib/db.server"
import { sendPacket } from "~/lib/packet-send.server"
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
	blueprintPaths: [] as string[],
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

describe("review: send_packet and mark_packet_sent", () => {
	const SUPERVISOR = { id: "sup-1", role: "SUPERVISOR", name: "Edgard Ocasio" }
	const doc = { ...approvedDoc, brigade: { area: "OESTE" } }

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: SUPERVISOR,
			session: {},
		} as any)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["OESTE"],
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(doc as any)
	})

	it("send_packet emails the packet through sendPacket and returns to the step", async () => {
		vi.mocked(sendPacket).mockResolvedValue({ ok: true, outcome: "SENT" })
		const res = await action({
			request: post(intent("send_packet")),
			params: { id: "doc-1" },
		} as any).catch((r) => r)
		expect(sendPacket).toHaveBeenCalledWith({
			docId: "doc-1",
			actor: SUPERVISOR,
			mode: "email",
		})
		expect(res.status).toBe(302)
		expect(res.headers.get("Location")).toBe("/docs/doc-1/review")
	})

	it("an UNCONFIGURED attempt also returns to the step (the history says so)", async () => {
		vi.mocked(sendPacket).mockResolvedValue({
			ok: true,
			outcome: "UNCONFIGURED",
		})
		const res = await action({
			request: post(intent("send_packet")),
			params: { id: "doc-1" },
		} as any).catch((r) => r)
		expect(res.status).toBe(302)
	})

	it.each([
		"packet.errors.prefield_missing",
		"packet.errors.blueprint_missing",
		"packet.errors.no_claro_supervisor",
		"packet.errors.render_failed",
		"docs_review.errors.installed_lines_required",
	] as const)("surfaces sendPacket's %s", async (errorKey) => {
		vi.mocked(sendPacket).mockResolvedValue({ ok: false, errorKey })
		const res = await action({
			request: post(intent("send_packet")),
			params: { id: "doc-1" },
		} as any)
		expect(res).toEqual({ errorKey })
	})

	it("mark_packet_sent records a manual send", async () => {
		vi.mocked(sendPacket).mockResolvedValue({ ok: true, outcome: "MANUAL" })
		const res = await action({
			request: post(intent("mark_packet_sent")),
			params: { id: "doc-1" },
		} as any).catch((r) => r)
		expect(sendPacket).toHaveBeenCalledWith({
			docId: "doc-1",
			actor: SUPERVISOR,
			mode: "manual",
		})
		expect(res.status).toBe(302)
	})

	it("mark_packet_sent surfaces sendPacket's errorKey", async () => {
		vi.mocked(sendPacket).mockResolvedValue({
			ok: false,
			errorKey: "packet.errors.locked",
		})
		const res = await action({
			request: post(intent("mark_packet_sent")),
			params: { id: "doc-1" },
		} as any)
		expect(res).toEqual({ errorKey: "packet.errors.locked" })
	})

	it("an out-of-scope supervisor never reaches sendPacket", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...doc,
			supervisorId: "other-sup",
			brigade: { area: "SUR" },
		} as any)
		await expect(
			action({
				request: post(intent("send_packet")),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
		expect(sendPacket).not.toHaveBeenCalled()
	})

	it("the legacy generate_jaf_invoice intent is gone: redirected, nothing written or sent", async () => {
		const res = await action({
			request: post(intent("generate_jaf_invoice")),
			params: { id: "doc-1" },
		} as any).catch((r) => r)
		expect(res.status).toBe(302)
		expect(res.headers.get("Location")).toBe("/docs/doc-1")
		expect(sendPacket).not.toHaveBeenCalled()
		expect(saveBuffer).not.toHaveBeenCalled()
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
		expect(db.auditTrail.create).not.toHaveBeenCalled()
	})
})

describe("review: save_aviso (supervisor: the Aviso PDF is the only source)", () => {
	// The real Claro print: Aviso # 10354739, services 34012039 × 1 and
	// 34012040 × 1. Prices are not on the PDF: codes on the JAF invoice keep the
	// invoice-time price, anything else uses the catalog price.
	const FIXTURE =
		"docs/JAF_Package/04 Sample Documents by Entity (Templates)/Finance Journey Example (single Aviso)/1.  AVISO 739.pdf"
	const AVISO_CATALOG = [
		{ id: "a1", claroCode: "34012039", unitPrice: "25.5000" },
		{ id: "a2", claroCode: "34012040", unitPrice: "30.0000" },
	]
	const line = (id: "a1" | "a2", qty: number) => ({
		serviceCodeId: id,
		claroCode: id === "a1" ? "34012039" : "34012040",
		accountCode: "610",
		name: id,
		unit: "EA",
		qty,
		// Invoice-time price 30 for both (a1's catalog price has since moved).
		unitPrice: 30,
		lineAmount: qty * 30,
	})
	const invoicedWith = (lines: ReturnType<typeof line>[]) => ({
		...approvedDoc,
		jafInvoiceGeneratedAt: new Date(),
		jafInvoiceLines: lines,
		jafInvoiceLineTotal: lines.reduce((s, l) => s + l.lineAmount, 0),
	})
	let pdfBytes: Buffer

	async function saveAviso(
		docLines: ReturnType<typeof line>[],
		extra: Record<string, string> = {},
	) {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			invoicedWith(docLines) as any,
		)
		const form = intent("save_aviso", { avisoNumber: "10354739", ...extra })
		form.set(
			"avisoPdf",
			new File([new Uint8Array(pdfBytes)], "1.  AVISO 739.pdf", {
				type: "application/pdf",
			}),
		)
		return action({ request: post(form), params: { id: "doc-1" } } as any)
	}

	beforeEach(async () => {
		vi.clearAllMocks()
		pdfBytes ??= await readFile(FIXTURE)
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR", name: "E" },
			session: {},
		} as any)
		vi.mocked(getActiveServiceCodes).mockResolvedValue(AVISO_CATALOG as any)
		vi.mocked(getAvisoAmountTolerance).mockResolvedValue(0.01)
		vi.mocked(saveUpload).mockResolvedValue(
			"/uploads/aviso-docs/doc-1-aviso.pdf",
		)
		vi.mocked(db.user.findMany).mockResolvedValue([])
	})

	it("stores the PDF's lines and stamps avisoMatchedAt + CLARO_UPLOADED when totals agree", async () => {
		await saveAviso([line("a1", 1), line("a2", 1)]).catch(() => {})
		expect(readAvisoPdf).toHaveBeenCalledTimes(1)
		expect(db.jafInvoice.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					avisoNumber: "10354739",
					avisoDocPath: "/uploads/aviso-docs/doc-1-aviso.pdf",
					avisoLineTotal: 60,
					avisoMatchedAt: expect.any(Date),
					status: "CLARO_UPLOADED",
					claroUploadedAt: expect.any(Date),
					// Quantities from the PDF, invoice-time price (not catalog 25.50).
					avisoLines: [
						{
							serviceCodeId: "a1",
							claroCode: "34012039",
							qty: 1,
							unitPrice: 30,
							lineAmount: 30,
						},
						{
							serviceCodeId: "a2",
							claroCode: "34012040",
							qty: 1,
							unitPrice: 30,
							lineAmount: 30,
						},
					],
				}),
			}),
		)
	})

	it("ignores typed quantities and prices: the supervisor's avisoLines field is not read", async () => {
		await saveAviso([line("a1", 1), line("a2", 1)], {
			avisoLines: JSON.stringify([
				{ serviceCodeId: "a1", claroCode: "34012039", qty: 9, unitPrice: 999 },
			]),
		}).catch(() => {})
		const data = vi.mocked(db.jafInvoice.update).mock.calls[0][0].data
		expect(data.avisoLineTotal).toBe(60)
		expect(data.avisoLines).toHaveLength(2)
	})

	it("stores the lines but does not stamp avisoMatchedAt on an amount mismatch", async () => {
		// Invoiced 3 × a1 + 1 × a2 = 120; the Aviso charges 1 + 1 = 60.
		const res = await saveAviso([line("a1", 3), line("a2", 1)])
		expect(res).toMatchObject({
			errorKey: "docs_review.errors.aviso_amount_mismatch",
			invoiceTotal: 120,
			avisoTotal: 60,
		})
		const data = vi.mocked(db.jafInvoice.update).mock.calls[0][0].data
		expect(data.avisoLineTotal).toBe(60)
		expect(data.avisoMatchedAt).toBeUndefined()
		expect(data.status).toBeUndefined()
	})

	it("requires a note when a line quantity differs but the total matches", async () => {
		// Invoiced 2 × a1 = 60; the Aviso charges 1 × a1 + 1 × a2 (catalog 30) = 60.
		const res = await saveAviso([line("a1", 2)])
		expect(res).toMatchObject({
			errorKey: "docs_review.errors.aviso_line_note_required",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("logs a QUANTITY_DISCREPANCY audit that does not block when a note is given", async () => {
		await saveAviso([line("a1", 2)], {
			lineNote: "Claro charged one as a2",
		}).catch(() => {})
		expect(db.auditTrail.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					action: "QUANTITY_DISCREPANCY",
					diffJson: expect.objectContaining({
						source: "AVISO",
						blocksFinance: false,
						note: "Claro charged one as a2",
					}),
				}),
			}),
		)
		const data = vi.mocked(db.jafInvoice.update).mock.calls[0][0].data
		expect(data.avisoMatchedAt).toEqual(expect.any(Date))
	})

	it("merges a service split over two PDF rows before matching", async () => {
		// The same print with 34012039 listed twice (1 + 1).
		const actual = (
			await vi.importActual<typeof import("~/lib/aviso-pdf.server")>(
				"~/lib/aviso-pdf.server",
			)
		).readAvisoPdf
		vi.mocked(readAvisoPdf).mockImplementationOnce(async (bytes) => {
			const parsed = await actual(bytes)
			return {
				...parsed,
				rows: [
					...parsed.rows,
					{ claroCode: "34012039", qtyInitial: 1, qtyUsed: 1 },
				],
			}
		})
		await saveAviso([line("a1", 2), line("a2", 1)]).catch(() => {})
		const data = vi.mocked(db.jafInvoice.update).mock.calls[0][0].data
		expect(data.avisoLineTotal).toBe(90)
		expect(data.avisoMatchedAt).toBeDefined()
		expect(data.avisoLines).toHaveLength(2)
		expect((data.avisoLines as any[])[0]).toMatchObject({
			serviceCodeId: "a1",
			qty: 2,
		})
		expect(db.auditTrail.create).not.toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ action: "QUANTITY_DISCREPANCY" }),
			}),
		)
	})

	it("refuses when the typed Aviso # is not the one on the PDF", async () => {
		const res = await saveAviso([line("a1", 1), line("a2", 1)], {
			avisoNumber: "10350001",
		})
		expect(res).toEqual({
			errorKey: "docs_review.errors.aviso_number_mismatch",
			pdfAvisoNumber: "10354739",
		})
		expect(saveUpload).not.toHaveBeenCalled()
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
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

	it("gives a supervisor none of the money", async () => {
		const data = await loadAs("SUPERVISOR")
		expect(data.showPrices).toBe(false)
		expect(data.invoiceSummary).toBeNull()
		expect("invoiceNumber" in data).toBe(false)
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

describe("review: send_back to crew is gone", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...approvedDoc,
			status: "FIELD_UPDATED",
			supervisorApprovedAt: null,
		} as any)
	})

	it("even an Admin's send_back writes nothing and notifies nobody", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1", role: "ADMIN", name: "Admin" },
			session: {},
		} as any)
		await expect(
			action({
				request: post(intent("send_back", { note: "fix it" })),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
		expect(db.auditTrail.create).not.toHaveBeenCalled()
		expect(db.notification.create).not.toHaveBeenCalled()
	})
})

describe("review loader: Packet → Claro step", () => {
	const CLARO = {
		id: "cs-1",
		name: "Ramón Claro",
		email: "ramon.now@claro.example",
		active: true,
		requiresPrefield: true,
		requiresBlueprint: true,
	}
	const signedOff = {
		...approvedDoc,
		brigade: { area: "OESTE" },
		claroSupervisorId: "cs-1",
		claroSupervisor: CLARO,
		ordenNumber: "ORD-1",
		pedido: null,
		smr: "SMR-1",
		titulo: "Poste",
		blueprintPaths: [],
		fieldMaterials: [
			{ serviceCodeId: "m1", used: 3, returned: 1, source: "WAREHOUSE" },
		],
		jafInvoicePdfPath: null,
	}
	const loadAs = async (role: string, doc: Record<string, unknown>) => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role, name: "Edgard Ocasio" },
			session: {},
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(doc as any)
		return loader({
			request: new Request("http://localhost/docs/doc-1/review"),
			params: { id: "doc-1" },
		} as any)
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["OESTE"],
		} as any)
		vi.mocked(db.photo.findMany).mockResolvedValue([])
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue(null)
		vi.mocked(db.brigade.findUnique).mockResolvedValue(null)
		vi.mocked(db.user.findMany).mockResolvedValue([])
		vi.mocked(db.packetSend.findMany).mockResolvedValue([])
		vi.mocked(db.serviceCode.findMany).mockResolvedValue([
			{ id: "m1", claroCode: "M-100", name: "Cable drop", unit: "FT" },
		] as any)
		vi.mocked(getActiveServiceCodes).mockResolvedValue(CATALOG as any)
		vi.mocked(getIvuRate).mockResolvedValue(0.115)
		vi.mocked(getAvisoAmountTolerance).mockResolvedValue(0.01)
	})

	it("gives the confirm the Claro supervisor's current directory email", async () => {
		const data = await loadAs("SUPERVISOR", signedOff)
		expect(data.packet.claroSupervisor).toEqual({
			name: "Ramón Claro",
			email: "ramon.now@claro.example",
			requiresPrefield: true,
		})
	})

	it("returns the send history: time, user, recipient, outcome", async () => {
		const at = new Date("2026-10-18T14:00:00Z")
		vi.mocked(db.packetSend.findMany).mockResolvedValue([
			{
				id: "ps-2",
				sentAt: at,
				recipientEmail: "ramon.old@claro.example",
				outcome: "UNCONFIGURED",
				error: null,
				sentBy: { name: "Edgard Ocasio" },
			},
		] as any)
		const data = await loadAs("SUPERVISOR", signedOff)
		expect(db.packetSend.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { docId: "doc-1" },
				orderBy: { sentAt: "desc" },
			}),
		)
		expect(data.packet.history).toEqual([
			{
				id: "ps-2",
				sentAt: at,
				sentBy: "Edgard Ocasio",
				recipientEmail: "ramon.old@claro.example",
				outcome: "UNCONFIGURED",
				error: null,
			},
		])
		expect(data.packet.canMarkManual).toBe(true)
	})

	it("offers Mark as sent manually after an UNCONFIGURED or FAILED attempt, before the first send only", async () => {
		const offered = async (
			outcomes: string[],
			doc: Record<string, unknown> = signedOff,
		) => {
			vi.mocked(db.packetSend.findMany).mockResolvedValue(
				outcomes.map((outcome, i) => ({
					id: `s${i}`,
					outcome,
					sentBy: { name: "E" },
				})) as any,
			)
			return (await loadAs("SUPERVISOR", doc)).packet.canMarkManual
		}
		expect(await offered([])).toBe(false)
		expect(await offered(["UNCONFIGURED"])).toBe(true)
		expect(await offered(["FAILED", "UNCONFIGURED"])).toBe(true)
		expect(await offered(["SENT"])).toBe(false)
		// A job already sent never offers it, whatever the last attempt was.
		const sent = {
			...signedOff,
			jafInvoiceGeneratedAt: new Date(),
			jafInvoiceLines: [],
		}
		expect(await offered(["UNCONFIGURED", "SENT"], sent)).toBe(false)
		expect(await offered(["FAILED", "MANUAL"], sent)).toBe(false)
	})

	it("a stored packet PDF from an UNCONFIGURED attempt is downloadable but not 'sent'", async () => {
		const data = await loadAs("SUPERVISOR", {
			...signedOff,
			jafInvoicePdfPath:
				"/uploads/packets/doc-1-packet-1700000000000-abcd1234.pdf",
			jafInvoiceGeneratedAt: null,
		})
		expect(data.packet.sent).toBe(false)
		expect(data.packet.packetHref).toBe(
			"/files/packets/doc-1-packet-1700000000000-abcd1234.pdf",
		)
	})

	it("sent is the first-send timestamp", async () => {
		const at = new Date("2026-10-18T15:00:00Z")
		const data = await loadAs("SUPERVISOR", {
			...signedOff,
			jafInvoiceGeneratedAt: at,
		})
		expect(data.packet.sent).toBe(true)
		expect(data.packet.sentAt).toEqual(at)
	})

	it("lists the blockers from the Claro supervisor's rules before the first send", async () => {
		const data = await loadAs("SUPERVISOR", signedOff)
		expect(data.packet.blockers).toEqual(["prefield", "blueprint"])
		expect(data.packet.prefieldMissing).toEqual(["pedido"])
	})

	it("blocks on a missing Claro supervisor, and the rules stop applying after the first send", async () => {
		const none = await loadAs("SUPERVISOR", {
			...signedOff,
			claroSupervisorId: null,
			claroSupervisor: null,
		})
		expect(none.packet.blockers).toEqual(["claro_supervisor"])
		const sent = await loadAs("SUPERVISOR", {
			...signedOff,
			jafInvoiceGeneratedAt: new Date(),
		})
		expect(sent.packet.blockers).toEqual([])
	})

	it("carries blueprint download links and the materials table, by code", async () => {
		const data = await loadAs("SUPERVISOR", {
			...signedOff,
			blueprintPaths: ["/uploads/blueprints/doc-1/plano 1.pdf"],
		})
		expect(data.packet.blueprints).toEqual([
			{
				name: "plano 1.pdf",
				href: "/files/blueprints/doc-1/plano%201.pdf",
			},
		])
		expect(data.packet.materials).toEqual([
			{
				claroCode: "M-100",
				name: "Cable drop",
				unit: "FT",
				used: 3,
				returned: 1,
				source: "WAREHOUSE",
			},
		])
	})

	describe("no prices reach a SUPERVISOR", () => {
		const PRICE_KEYS = new Set([
			"unitPrice",
			"lineAmount",
			"jafInvoiceLineTotal",
			"avisoLineTotal",
			"total",
			"claroBasePrice",
			"upliftFactor",
			"contractorPrice",
			"contractorFactor",
			"advanceAmount",
			"finalPaymentAmount",
			"contractorShareLines",
			"grossPayable",
			"retentionAmount",
			"netPayable",
		])
		const priced = {
			...signedOff,
			status: "CLARO_UPLOADED",
			jafInvoiceGeneratedAt: new Date(),
			jafInvoiceLines: [
				{
					serviceCodeId: "c1",
					claroCode: "34006301",
					name: "TRANSFER",
					unit: "EA",
					qty: 5,
					unitPrice: 42.343,
					lineAmount: 211.72,
				},
			],
			jafInvoiceLineTotal: 211.72,
			avisoLines: [
				{
					serviceCodeId: "c1",
					claroCode: "34006301",
					qty: 5,
					unitPrice: 42.343,
					lineAmount: 211.72,
				},
			],
			avisoLineTotal: 211.72,
			avisoMatchedAt: new Date(),
			grossPayable: 137.62,
			retentionAmount: 13.76,
			netPayable: 123.86,
			advanceAmount: 100,
			finalPaymentAmount: 23.86,
			contractorShareLines: [{ lineAmount: 137.62 }],
		}
		const sheet = {
			id: "s1",
			version: 1,
			total: 211.72,
			lines: [
				{
					serviceCodeId: "c1",
					claroCode: "34006301",
					description: "TRANSFER",
					installedQty: 5,
					certifiedQty: 5,
					unitPrice: 42.343,
					lineAmount: 211.72,
				},
			],
			sigSupervisorAt: null,
			sigSubcontractorAt: null,
		}
		const priceKeysIn = (v: unknown, at = "$"): string[] => {
			if (Array.isArray(v))
				return v.flatMap((x, i) => priceKeysIn(x, `${at}[${i}]`))
			if (v && typeof v === "object" && !(v instanceof Date))
				return Object.entries(v).flatMap(([k, x]) => [
					...(PRICE_KEYS.has(k) && x != null ? [`${at}.${k}`] : []),
					...priceKeysIn(x, `${at}.${k}`),
				])
			return []
		}

		it.each(["INVOICE", "AVISO", "PRECERT"])(
			"on the %s view the payload has no price field or amount",
			async (step) => {
				vi.mocked(db.preCertSheet.findFirst).mockResolvedValue(sheet as any)
				vi.mocked(requireRole).mockResolvedValue({
					user: { id: "sup-1", role: "SUPERVISOR", name: "E" },
					session: {},
				} as any)
				vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
					priced as any,
				)
				const data = await loader({
					request: new Request(
						`http://localhost/docs/doc-1/review?step=${step}`,
					),
					params: { id: "doc-1" },
				} as any)
				expect(priceKeysIn(data)).toEqual([])
				const json = JSON.stringify(data)
				for (const amount of ["42.343", "211.72", "137.62", "123.86"])
					expect(json).not.toContain(amount)
				// The Aviso card still gets the server's verdict on the amount.
				expect(data.avisoAmountOk).toBe(true)
			},
		)

		it("Admin keeps the prices", async () => {
			vi.mocked(db.preCertSheet.findFirst).mockResolvedValue(sheet as any)
			const data = await loadAs("ADMIN", priced)
			expect(priceKeysIn(data).length).toBeGreaterThan(0)
			expect(data.serviceCodes[0].unitPrice).toBe(42.343)
		})
	})
})
