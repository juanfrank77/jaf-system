import { readFile } from "node:fs/promises"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/db.server", () => {
	const db: any = {
		jafInvoice: {
			findUniqueOrThrow: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn(async () => ({ count: 1 })),
		},
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
	}
	// An interactive transaction runs against the same mocked client.
	db.$transaction = vi.fn(async (ops: any) =>
		typeof ops === "function" ? ops(db) : Promise.all(ops),
	)
	return { db }
})
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
vi.mock("~/lib/packet-send.server", () => ({
	sendPacket: vi.fn(),
	buildPacketInput: vi.fn(),
	buildPrefieldInput: vi.fn(),
	loadWorkOrderDocument: vi.fn(async () => null),
}))
vi.mock("~/lib/pdf/claro-packet.server", () => ({
	generateClaroPacketPdf: vi.fn(async () => Buffer.from("%PDF-wo")),
}))
vi.mock("~/lib/pdf/claro-prefield.server", () => ({
	generateClaroPrefieldPdf: vi.fn(async () => Buffer.from("%PDF-prefield")),
}))
// The real Aviso reader runs on the real sample PDF; the spy only lets a
// test feed it a different number or a read failure.
vi.mock("~/lib/aviso-pdf.server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("~/lib/aviso-pdf.server")>()
	return { ...actual, readAvisoNumber: vi.fn(actual.readAvisoNumber) }
})

import { Document, Page, renderToBuffer } from "@react-pdf/renderer"
import { createElement } from "react"
import { AvisoPdfError, readAvisoNumber } from "~/lib/aviso-pdf.server"
import { db } from "~/lib/db.server"
import {
	buildPacketInput,
	buildPrefieldInput,
	sendPacket,
} from "~/lib/packet-send.server"
import { generateClaroPacketPdf } from "~/lib/pdf/claro-packet.server"
import { generateClaroPrefieldPdf } from "~/lib/pdf/claro-prefield.server"
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
	contractorAccountCode: null,
	releasedToFinanceAt: null,
	fieldSubmittedAt: new Date("2026-08-26T20:12:00Z"),
	assignedCrewIds: ["crew-1"],
	blueprintPaths: [] as string[],
}

afterEach(() => {
	vi.unstubAllEnvs()
})

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
		"packet.errors.prefield_pdf_missing",
		"packet.errors.package_stale",
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

describe("review: save_aviso (step 6: the number on the file is the only check)", () => {
	// The real Claro print: Aviso # 10354739, services 34012039 × 1 and
	// 34012040 × 1. Its rows and amounts are never compared with the job.
	const FIXTURE =
		"docs/JAF_Package/04 Sample Documents by Entity (Templates)/Finance Journey Example (single Aviso)/1.  AVISO 739.pdf"
	const sentDoc = {
		...approvedDoc,
		jafInvoiceGeneratedAt: new Date(),
		// Invoiced 3 × c1 + 1 × c2: not what the Aviso print lists.
		jafInvoiceLines: [
			{ serviceCodeId: "c1", claroCode: "34006301", qty: 3 },
			{ serviceCodeId: "c2", claroCode: "34007030", qty: 1 },
		],
	}
	let pdfBytes: Buffer

	const pdfFile = (bytes: Uint8Array = pdfBytes) =>
		new File([new Uint8Array(bytes)], "1.  AVISO 739.pdf", {
			type: "application/pdf",
		})

	async function saveAviso(
		over: Record<string, unknown> = {},
		fields: Record<string, string> = {},
		file: File | null = pdfFile(),
	) {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...sentDoc,
			...over,
		} as any)
		const form = intent("save_aviso", { avisoNumber: "10354739", ...fields })
		if (file) form.set("avisoPdf", file)
		return action({ request: post(form), params: { id: "doc-1" } } as any)
	}
	const audits = () =>
		vi.mocked(db.auditTrail.create).mock.calls.map((c) => c[0].data.action)
	const expectNothingWritten = () => {
		expect(saveUpload).not.toHaveBeenCalled()
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
		expect(db.auditTrail.create).not.toHaveBeenCalled()
		expect(db.preCertSheet.create).not.toHaveBeenCalled()
		expect(db.preCertSheet.update).not.toHaveBeenCalled()
	}

	beforeEach(async () => {
		vi.clearAllMocks()
		pdfBytes ??= await readFile(FIXTURE)
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR", name: "E" },
			session: {},
		} as any)
		vi.mocked(getActiveServiceCodes).mockResolvedValue(CATALOG as any)
		vi.mocked(saveUpload).mockResolvedValue(
			"/uploads/aviso-docs/doc-1-aviso.pdf",
		)
		vi.mocked(generatePreCertSheetPdf).mockResolvedValue(Buffer.from("pdf"))
		vi.mocked(saveBuffer).mockResolvedValue("/uploads/precert/doc-1-v1.pdf")
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue(null)
		vi.mocked(db.preCertSheet.create).mockResolvedValue({
			id: "sheet-new",
		} as any)
		vi.mocked(db.user.findMany).mockResolvedValue([])
	})

	it("blocks a file whose number is not the typed one, showing both, and writes nothing", async () => {
		vi.mocked(readAvisoNumber).mockResolvedValueOnce("10353962")
		const res = await saveAviso({}, { avisoNumber: "10353961" })
		expect(res).toEqual({
			errorKey: "docs_review.errors.aviso_number_mismatch",
			typedNumber: "10353961",
			pdfAvisoNumber: "10353962",
		})
		expectNothingWritten()
	})

	it("saves the number and file, logs one AVISO_CAPTURED and creates exactly one pre-cert sheet", async () => {
		await expect(saveAviso()).rejects.toMatchObject({ status: 302 })
		expect(readAvisoNumber).toHaveBeenCalledTimes(1)
		expect(db.jafInvoice.update).toHaveBeenCalledTimes(1)
		const data = vi.mocked(db.jafInvoice.update).mock.calls[0][0].data
		expect(data).toMatchObject({
			avisoNumber: "10354739",
			avisoDocPath: "/uploads/aviso-docs/doc-1-aviso.pdf",
			status: "CLARO_UPLOADED",
			claroUploadedAt: expect.any(Date),
		})
		expect(data).not.toHaveProperty("avisoLines")
		expect(data).not.toHaveProperty("avisoLineTotal")
		expect(data).not.toHaveProperty("avisoMatchedAt")
		expect(audits().filter((a) => a === "AVISO_CAPTURED")).toHaveLength(1)
		expect(audits()).not.toContain("QUANTITY_DISCREPANCY")
		expect(audits()).toContain("PRECERT_GENERATED")
		expect(db.preCertSheet.create).toHaveBeenCalledTimes(1)
		expect(db.preCertSheet.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				docId: "doc-1",
				version: 1,
				// From what the crew installed, not from the Aviso.
				lines: [
					expect.objectContaining({ claroCode: "34006301", certifiedQty: 5 }),
					expect.objectContaining({ claroCode: "34007030", certifiedQty: 2 }),
				],
			}),
		})
		expect(db.preCertSheet.update).not.toHaveBeenCalled()
	})

	it("saves an Aviso whose rows and amounts differ from the work order: there is no mismatch", async () => {
		const res = await saveAviso().catch((e) => e)
		expect(res).toMatchObject({ status: 302 })
		expect(db.jafInvoice.update).toHaveBeenCalledTimes(1)
	})

	it("ignores any typed lines or line note", async () => {
		await saveAviso(
			{},
			{
				avisoLines: JSON.stringify([
					{ serviceCodeId: "c1", claroCode: "34006301", qty: 9, unitPrice: 9 },
				]),
				lineNote: "x",
			},
		).catch(() => {})
		const data = vi.mocked(db.jafInvoice.update).mock.calls[0][0].data
		expect(data).not.toHaveProperty("avisoLines")
		expect(audits()).not.toContain("QUANTITY_DISCREPANCY")
	})

	it("an Admin goes through the same number check", async () => {
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "admin-1", role: "ADMIN", name: "A" },
			session: {},
		} as any)
		const res = await saveAviso({}, { avisoNumber: "10350001" })
		expect(res).toMatchObject({
			errorKey: "docs_review.errors.aviso_number_mismatch",
			typedNumber: "10350001",
			pdfAvisoNumber: "10354739",
		})
		expectNothingWritten()
	})

	it("blocks a PDF with no text (a scan) with a readable message and writes nothing", async () => {
		const blank = new Uint8Array(
			await renderToBuffer(
				createElement(Document, null, createElement(Page, { size: "A4" })),
			),
		)
		const res = await saveAviso({}, {}, pdfFile(blank))
		expect(res).toEqual({ errorKey: "docs_review.errors.aviso_pdf_unreadable" })
		expectNothingWritten()
	})

	it("blocks a PDF carrying several Aviso numbers and writes nothing", async () => {
		vi.mocked(readAvisoNumber).mockRejectedValueOnce(
			new AvisoPdfError("multiple_numbers"),
		)
		const res = await saveAviso()
		expect(res).toEqual({ errorKey: "docs_review.errors.aviso_pdf_multiple" })
		expectNothingWritten()
	})

	it("requires the number and a file", async () => {
		expect(await saveAviso({}, { avisoNumber: "" })).toEqual({
			errorKey: "docs_review.errors.aviso_number_required",
		})
		expect(await saveAviso({}, {}, null)).toEqual({
			errorKey: "docs_review.errors.aviso_pdf_required",
		})
		expectNothingWritten()
	})

	it("re-checks the file already on record when no new file is sent", async () => {
		await expect(
			saveAviso({ avisoNumber: "10354739", avisoDocPath: FIXTURE }, {}, null),
		).rejects.toMatchObject({ status: 302 })
		expect(saveUpload).not.toHaveBeenCalled()
		expect(db.jafInvoice.update).toHaveBeenCalledTimes(1)
		const res = await saveAviso(
			{ avisoNumber: "10354739", avisoDocPath: FIXTURE },
			{ avisoNumber: "10350001" },
			null,
		)
		expect(res).toMatchObject({
			errorKey: "docs_review.errors.aviso_number_mismatch",
			pdfAvisoNumber: "10354739",
		})
	})

	it("refuses when nothing was installed, before writing anything", async () => {
		const res = await saveAviso({ installedServiceLines: [] })
		expect(res).toEqual({
			errorKey: "docs_review.errors.installed_lines_required",
		})
		expectNothingWritten()
	})

	it("re-saving with a new file supersedes the unsigned sheet (version 2), not a duplicate", async () => {
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue({
			id: "sheet-1",
			version: 1,
			sigSupervisorAt: null,
			sigSubcontractorAt: null,
			sigClaroAt: null,
		} as any)
		await expect(
			saveAviso({
				status: "CLARO_UPLOADED",
				avisoNumber: "10354739",
				avisoDocPath: "/uploads/aviso-docs/doc-1-aviso.pdf",
			}),
		).rejects.toMatchObject({ status: 302 })
		expect(db.preCertSheet.update).toHaveBeenCalledWith({
			where: { id: "sheet-1" },
			data: { supersededAt: expect.any(Date) },
		})
		expect(db.preCertSheet.create).toHaveBeenCalledTimes(1)
		expect(db.preCertSheet.create).toHaveBeenCalledWith({
			data: expect.objectContaining({ version: 2 }),
		})
	})

	it("re-saving after the sheet was signed leaves the signed sheet alone and says so", async () => {
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue({
			id: "sheet-1",
			version: 1,
			sigSupervisorAt: new Date(),
			sigSubcontractorAt: null,
			sigClaroAt: null,
		} as any)
		const res = await saveAviso({
			status: "CLARO_UPLOADED",
			avisoNumber: "10354739",
			avisoDocPath: "/uploads/aviso-docs/doc-1-aviso.pdf",
		})
		expect(res).toEqual({ noteKey: "docs_review.aviso_resaved_signed" })
		expect(db.jafInvoice.update).toHaveBeenCalledTimes(1)
		expect(audits()).toEqual(["AVISO_CAPTURED"])
		expect(db.preCertSheet.create).not.toHaveBeenCalled()
		expect(db.preCertSheet.update).not.toHaveBeenCalled()
		expect(generatePreCertSheetPdf).not.toHaveBeenCalled()
	})

	it("requires the packet to have been sent first", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(
			approvedDoc as any,
		)
		const res = await action({
			request: post(intent("save_aviso", { avisoNumber: "1" })),
			params: { id: "doc-1" },
		} as any)
		expect(res).toEqual({ errorKey: "docs_review.errors.invoice_required" })
	})
})

describe("review: edit_aviso (number only)", () => {
	const FIXTURE =
		"docs/JAF_Package/04 Sample Documents by Entity (Templates)/Finance Journey Example (single Aviso)/1.  AVISO 739.pdf"
	async function editAviso(over: Record<string, unknown>, avisoNumber: string) {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...approvedDoc,
			...over,
		} as any)
		return action({
			request: post(intent("edit_aviso", { avisoNumber })),
			params: { id: "doc-1" },
		} as any)
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR", name: "E" },
			session: {},
		} as any)
	})

	it("refuses a number that is not the one on the file on record", async () => {
		const res = await editAviso({ avisoDocPath: FIXTURE }, "10350001")
		expect(res).toEqual({
			errorKey: "docs_review.errors.aviso_number_mismatch",
			typedNumber: "10350001",
			pdfAvisoNumber: "10354739",
		})
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
		expect(db.auditTrail.create).not.toHaveBeenCalled()
	})

	it("sets the number when it equals the file's", async () => {
		await expect(
			editAviso({ avisoDocPath: FIXTURE }, "10354739"),
		).rejects.toMatchObject({ status: 302 })
		expect(db.jafInvoice.update).toHaveBeenCalledWith({
			where: { id: "doc-1" },
			data: { avisoNumber: "10354739" },
		})
	})

	it("sets any number while no file is on record", async () => {
		await expect(editAviso({}, "10350001")).rejects.toMatchObject({
			status: 302,
		})
		expect(db.auditTrail.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ action: "AVISO_NUMBER_SET" }),
			}),
		)
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

	it("refuses generation before the Aviso is saved", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...matched,
			avisoDocPath: null,
		} as any)
		const res = await action({
			request: post(intent("generate_precert")),
			params: { id: "doc-1" },
		} as any)
		expect(res).toEqual({
			errorKey: "docs_review.errors.aviso_pdf_required",
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
		jafInvoicePdfPath: "/var/jaf/uploads/packets/doc-1-packet-1.pdf",
		avisoDocPath: "/x/aviso.pdf",
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

	it("releases when the four documents are present and notifies Finance", async () => {
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
					"MAINT-260903-001 · Aviso 10353961 · Jesús Martínez — ready for payment request",
			},
		})
		const msg = vi.mocked(db.notification.create).mock.calls[0][0].data
			.message as string
		expect(msg).not.toMatch(/[$€]|\d+\.\d{2}/)
		expect(db.auditTrail.create).toHaveBeenCalledWith({
			data: {
				docId: "doc-1",
				userId: "sup-1",
				action: "RELEASED_TO_FINANCE",
				diffJson: { rows: expect.any(Array) },
			},
		})
	})

	it.each([
		["only a DURING photo", [{ tag: "DURING" }]],
		["only a BEFORE photo", [{ tag: "BEFORE" }]],
	])("refuses with %s and marks the photos row missing", async (_n, photos) => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(ready as any)
		vi.mocked(db.photo.findMany).mockResolvedValue(photos as any)
		vi.mocked(photosThatLoad).mockResolvedValueOnce(photos as any)
		const res = await action({
			request: post(intent("release_to_finance")),
			params: { id: "doc-1" },
		} as any)
		expect(res).toMatchObject({
			errorKey: "docs_review.errors.release_blocked",
		})
		expect(res.rows?.find((c: { key: string }) => c.key === "photos")?.ok).toBe(
			false,
		)
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
		expect(db.notification.create).not.toHaveBeenCalled()
	})

	it("refuses when the stored PDF is a legacy priced invoice", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...ready,
			jafInvoicePdfPath: "/var/jaf/uploads/jaf-invoices/doc-1.pdf",
		} as any)
		const res = await action({
			request: post(intent("release_to_finance")),
			params: { id: "doc-1" },
		} as any)
		expect(
			res.rows?.find((c: { key: string }) => c.key === "work_order_pdf")?.ok,
		).toBe(false)
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
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
		expect(res.rows?.find((c: { key: string }) => c.key === "photos")?.ok).toBe(
			false,
		)
		expect(db.jafInvoice.update).not.toHaveBeenCalled()
	})

	it("refuses when the photo rows exist but the files do not load", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(ready as any)
		vi.mocked(photosThatLoad).mockResolvedValueOnce([])
		const res = await action({
			request: post(intent("release_to_finance")),
			params: { id: "doc-1" },
		} as any)
		expect(res.rows?.find((c: { key: string }) => c.key === "photos")?.ok).toBe(
			false,
		)
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

	it("clears the stored work order PDF, so step 4 has to generate it again", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...doc,
			jafInvoicePdfPath: "/var/jaf/uploads/packets/wo.pdf",
		} as any)
		await expect(
			action({
				request: post(intent("back_to_approve", { note: "qty is off" })),
				params: { id: "doc-1" },
			} as any),
		).rejects.toMatchObject({ status: 302 })
		expect(db.jafInvoice.update).toHaveBeenCalledWith({
			where: { id: "doc-1" },
			data: {
				status: "FIELD_UPDATED",
				supervisorApprovedAt: null,
				jafInvoicePdfPath: null,
			},
		})
		expect(db.auditTrail.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				action: "BACK_TO_APPROVE",
				diffJson: expect.objectContaining({
					jafInvoicePdfPath: {
						before: "/var/jaf/uploads/packets/wo.pdf",
						after: null,
					},
				}),
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
		prefieldNeeded: true,
		prefieldPdfPath: null,
		packetStale: false,
		blueprintPaths: [],
		fieldMaterials: [
			{ serviceCodeId: "m1", used: 3, returned: 1, source: "WAREHOUSE_ISSUE" },
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
		vi.stubEnv("PACKET_EMAIL_ENABLED", "true")
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
		vi.stubEnv("PACKET_EMAIL_ENABLED", "true")
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

	it("with email off, the manual send is offered once the step 4 PDF is stored, before the first send", async () => {
		vi.stubEnv("PACKET_EMAIL_ENABLED", "")
		vi.mocked(db.packetSend.findMany).mockResolvedValue([] as any)
		const none = (await loadAs("SUPERVISOR", signedOff)).packet
		expect(none.emailEnabled).toBe(false)
		expect(none.canMarkManual).toBe(false)
		const stored = (
			await loadAs("SUPERVISOR", {
				...signedOff,
				jafInvoicePdfPath: "packets/doc-1-work-order-1.pdf",
			})
		).packet
		expect(stored.canMarkManual).toBe(true)
		const sentDoc = (
			await loadAs("SUPERVISOR", {
				...signedOff,
				jafInvoicePdfPath: "packets/doc-1-work-order-1.pdf",
				jafInvoiceGeneratedAt: new Date(),
				jafInvoiceLines: [],
			})
		).packet
		expect(sentDoc.canMarkManual).toBe(false)
		// An old priced invoice is not the step 4 PDF.
		const legacy = (
			await loadAs("SUPERVISOR", {
				...signedOff,
				jafInvoicePdfPath: "/uploads/jaf-invoices/doc-1-jaf-invoice.pdf",
			})
		).packet
		expect(legacy.canMarkManual).toBe(false)
		expect(legacy.packetHref).toBeNull()
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

	it("never links a legacy priced JAF invoice as the packet", async () => {
		const data = await loadAs("SUPERVISOR", {
			...signedOff,
			jafInvoicePdfPath: "/uploads/jaf-invoices/doc-1-jaf-invoice.pdf",
			jafInvoiceGeneratedAt: new Date("2026-09-01T12:00:00Z"),
		})
		expect(data.packet.packetHref).toBeNull()
		expect(JSON.stringify(data)).not.toContain("jaf-invoices")
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

	it("lists the blockers before the first send: the Prefield PDF, the blueprint rule, a stale package", async () => {
		const data = await loadAs("SUPERVISOR", signedOff)
		expect(data.packet.blockers).toEqual(["prefield_pdf", "blueprint"])
		expect(data.packet.prefieldNeeded).toBe(true)
		const stale = await loadAs("SUPERVISOR", {
			...signedOff,
			prefieldNeeded: false,
			packetStale: true,
		})
		expect(stale.packet.blockers).toEqual(["blueprint", "stale"])
	})

	it("blocks on a missing Claro supervisor, and the rules stop applying after the first send", async () => {
		const none = await loadAs("SUPERVISOR", {
			...signedOff,
			claroSupervisorId: null,
			claroSupervisor: null,
		})
		expect(none.packet.blockers).toEqual(["claro_supervisor", "prefield_pdf"])
		const sent = await loadAs("SUPERVISOR", {
			...signedOff,
			jafInvoiceGeneratedAt: new Date(),
		})
		expect(sent.packet.blockers).toEqual([])
	})

	it("names the crew with its contract number on the step 5 card", async () => {
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b1",
			name: "JESUS MARTINEZ",
			code: "009",
		} as any)
		const data = await loadAs("SUPERVISOR", signedOff)
		expect(data.invoiceHeader.brigadeName).toBe("JESUS MARTINEZ · 009")
		vi.mocked(db.brigade.findUnique).mockResolvedValue({
			id: "b1",
			name: "JESUS MARTINEZ",
			code: null,
		} as any)
		expect(
			(await loadAs("SUPERVISOR", signedOff)).invoiceHeader.brigadeName,
		).toBe("JESUS MARTINEZ")
	})

	it("lists the package files (no server paths) with the zip, and the materials table, by code", async () => {
		vi.mocked(db.photo.findMany).mockResolvedValue([
			{
				localPath: "/uploads/photos/doc-1/after.jpg",
				takenAt: new Date("2026-10-19T12:00:00Z"),
				tag: "AFTER",
			},
			{
				localPath: "/uploads/photos/doc-1/before.jpg",
				takenAt: new Date("2026-10-19T09:00:00Z"),
				tag: "BEFORE",
			},
		] as any)
		const data = await loadAs("SUPERVISOR", {
			...signedOff,
			jafInvoicePdfPath: "/uploads/packets/doc-1-work-order-1.pdf",
			prefieldPdfPath: "/uploads/packets/doc-1-prefield-1.pdf",
			blueprintPaths: ["/uploads/blueprints/doc-1/plano 1.pdf"],
		})
		expect(data.packet.files).toEqual([
			{
				key: "work_order_pdf",
				name: "doc-1-work-order-1.pdf",
				href: "/files/packets/doc-1-work-order-1.pdf",
			},
			{
				key: "prefield_pdf",
				name: "doc-1-prefield-1.pdf",
				href: "/files/packets/doc-1-prefield-1.pdf",
			},
			{
				key: "photo",
				name: "before.jpg",
				href: "/files/photos/doc-1/before.jpg",
			},
			{
				key: "photo",
				name: "after.jpg",
				href: "/files/photos/doc-1/after.jpg",
			},
			{
				key: "blueprint",
				name: "plano 1.pdf",
				href: "/files/blueprints/doc-1/plano%201.pdf",
			},
		])
		expect(data.packet.zipHref).toBe("/docs/doc-1/package")
		vi.mocked(db.photo.findMany).mockResolvedValue([])
		expect((await loadAs("SUPERVISOR", signedOff)).packet.zipHref).toBeNull()
		expect(data.packet.materials).toEqual([
			{
				serviceCodeId: "m1",
				claroCode: "M-100",
				name: "Cable drop",
				unit: "FT",
				used: 3,
				returned: 1,
				source: "WAREHOUSE_ISSUE",
			},
		])
	})

	it("previews the work order PDF's materials: every Source, used lines only", async () => {
		const data = await loadAs("SUPERVISOR", {
			...signedOff,
			fieldMaterials: [
				{
					serviceCodeId: "m1",
					used: 3,
					returned: 1,
					source: "WAREHOUSE_ISSUE",
				},
				{ serviceCodeId: "m2", used: 4, returned: 0, source: "TRUCK_STOCK" },
				{
					serviceCodeId: "m3",
					used: 0,
					returned: 2,
					source: "WAREHOUSE_ISSUE",
				},
			],
		})
		expect(
			data.packet.materials.map((m) => [m.serviceCodeId, m.source]),
		).toEqual([
			["m1", "WAREHOUSE_ISSUE"],
			["m2", "TRUCK_STOCK"],
		])
		expect(db.serviceCode.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: { in: ["m1", "m2"] } } }),
		)
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
			avisoNumber: "10353961",
			avisoDocPath: "/uploads/aviso-docs/doc-1-aviso.pdf",
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
				// Step 6 has no amount check at all (spec F2).
				expect(data).not.toHaveProperty("avisoAmountOk")
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

describe("review: generate_package (step 4)", () => {
	const CLARO = {
		id: "cs-1",
		name: "Ramón Claro",
		email: "ramon@claro.example",
		active: true,
		requiresPrefield: false,
		requiresBlueprint: false,
	}
	const signed = {
		...approvedDoc,
		brigade: { area: "OESTE" },
		claroSupervisorId: "cs-1",
		claroSupervisor: CLARO,
		completionSignature: "data:image/png;base64,iVBORw0KGgo=",
		completionSignedAt: new Date(),
		jafInvoicePdfPath: null,
		prefieldNeeded: false,
		prefieldPdfPath: null,
		packetStale: false,
	}
	const PACKET = {
		document: { workOrderNumber: "MAINT-260903-001" },
		issuedOn: new Date(),
		showPickupSignatures: true,
	}
	const PREFIELD = { workOrderNumber: "MAINT-260903-001", deptNumber: "OESTE" }
	const run = () =>
		action({
			request: post(intent("generate_package")),
			params: { id: "doc-1" },
		} as any).catch((r) => r)

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR", name: "Edgard Ocasio" },
			session: {},
		} as any)
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["OESTE"],
		} as any)
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(signed as any)
		vi.mocked(buildPacketInput).mockResolvedValue(PACKET as any)
		vi.mocked(buildPrefieldInput).mockResolvedValue(PREFIELD as any)
		vi.mocked(saveBuffer).mockImplementation(async (_kind, name) =>
			name.includes("-prefield-")
				? "/var/jaf/uploads/packets/pf.pdf"
				: "/var/jaf/uploads/packets/wo.pdf",
		)
		vi.mocked(db.jafInvoice.updateMany).mockResolvedValue({ count: 1 } as any)
	})

	it("renders the work order, stores its path and writes WORK_ORDER_PDF_GENERATED", async () => {
		const res = await run()
		expect(res.status).toBe(302)
		expect(res.headers.get("Location")).toBe("/docs/doc-1/review?step=APPROVE")
		expect(buildPacketInput).toHaveBeenCalledWith("doc-1")
		expect(generateClaroPacketPdf).toHaveBeenCalledWith(PACKET)
		// Prefield not needed: no Prefield PDF.
		expect(generateClaroPrefieldPdf).not.toHaveBeenCalled()
		expect(saveBuffer).toHaveBeenCalledTimes(1)
		expect(vi.mocked(saveBuffer).mock.calls[0][0]).toBe("packets")
		expect(db.jafInvoice.updateMany).toHaveBeenCalledWith({
			where: { id: "doc-1", jafInvoiceGeneratedAt: null },
			data: {
				jafInvoicePdfPath: "/var/jaf/uploads/packets/wo.pdf",
				prefieldPdfPath: null,
				packetStale: false,
			},
		})
		expect(db.auditTrail.create).toHaveBeenCalledWith({
			data: {
				docId: "doc-1",
				userId: "sup-1",
				action: "WORK_ORDER_PDF_GENERATED",
				diffJson: {
					jafInvoicePdfPath: {
						before: null,
						after: "/var/jaf/uploads/packets/wo.pdf",
					},
					prefieldGenerated: false,
				},
			},
		})
	})

	it("Prefield needed: renders the Prefield PDF too, named with the -prefield- infix", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...signed,
			prefieldNeeded: true,
			packetStale: true,
		} as any)
		await run()
		expect(buildPrefieldInput).toHaveBeenCalledWith("doc-1")
		expect(generateClaroPrefieldPdf).toHaveBeenCalledWith(PREFIELD)
		const names = vi.mocked(saveBuffer).mock.calls.map((c) => c[1])
		expect(names[1]).toMatch(/^doc-1-prefield-\d+\.pdf$/)
		expect(db.jafInvoice.updateMany).toHaveBeenCalledWith({
			where: { id: "doc-1", jafInvoiceGeneratedAt: null },
			data: {
				jafInvoicePdfPath: "/var/jaf/uploads/packets/wo.pdf",
				prefieldPdfPath: "/var/jaf/uploads/packets/pf.pdf",
				packetStale: false,
			},
		})
		expect(db.auditTrail.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				diffJson: {
					jafInvoicePdfPath: {
						before: null,
						after: "/var/jaf/uploads/packets/wo.pdf",
					},
					prefieldGenerated: true,
					prefieldPdfPath: {
						before: null,
						after: "/var/jaf/uploads/packets/pf.pdf",
					},
					packetStale: { before: true, after: false },
				},
			}),
		})
	})

	it("regenerating overwrites the stored path", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...signed,
			jafInvoicePdfPath: "/var/jaf/uploads/packets/old.pdf",
		} as any)
		await run()
		expect(db.jafInvoice.updateMany).toHaveBeenCalledWith({
			where: { id: "doc-1", jafInvoiceGeneratedAt: null },
			data: expect.objectContaining({
				jafInvoicePdfPath: "/var/jaf/uploads/packets/wo.pdf",
			}),
		})
	})

	it("generates with the warehouse and crew signatures missing", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...signed,
			releaseSignature: null,
			crewSignature: null,
		} as any)
		const res = await run()
		expect(res.status).toBe(302)
		expect(db.jafInvoice.updateMany).toHaveBeenCalled()
	})

	it("is refused before the supervisor signs off", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...signed,
			status: "FIELD_UPDATED",
			supervisorApprovedAt: null,
			completionSignature: null,
		} as any)
		expect(await run()).toEqual({ errorKey: "packet.errors.not_signed_off" })
		expect(generateClaroPacketPdf).not.toHaveBeenCalled()
		expect(db.jafInvoice.updateMany).not.toHaveBeenCalled()
		expect(db.auditTrail.create).not.toHaveBeenCalled()
	})

	it("is refused once the PDF has been sent to Claro", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...signed,
			jafInvoiceGeneratedAt: new Date(),
			jafInvoicePdfPath: "/var/jaf/uploads/packets/sent.pdf",
		} as any)
		expect(await run()).toEqual({ errorKey: "packet.errors.locked" })
		expect(generateClaroPacketPdf).not.toHaveBeenCalled()
		expect(db.jafInvoice.updateMany).not.toHaveBeenCalled()
	})

	it.each([
		["a priced invoice", "/var/jaf/uploads/jaf-invoices/doc-1-jaf-invoice.pdf"],
		["no file", null],
	])(
		"a job sent under the old flow (%s stored) can still generate it, so it can be released",
		async (_label, legacyPath) => {
			vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
				...signed,
				status: "CLARO_UPLOADED",
				jafInvoiceGeneratedAt: new Date("2026-09-01T12:00:00Z"),
				jafInvoicePdfPath: legacyPath,
				// The old flow had no Claro supervisor directory nor this signature.
				claroSupervisorId: null,
				claroSupervisor: null,
				completionSignature: null,
			} as any)
			const res = await run()
			expect(res.status).toBe(302)
			expect(db.jafInvoice.updateMany).toHaveBeenCalledWith({
				where: { id: "doc-1", jafInvoicePdfPath: legacyPath },
				data: { jafInvoicePdfPath: "/var/jaf/uploads/packets/wo.pdf" },
			})
			expect(db.auditTrail.create).toHaveBeenCalledWith({
				data: expect.objectContaining({
					action: "WORK_ORDER_PDF_GENERATED",
					diffJson: expect.objectContaining({
						jafInvoicePdfPath: {
							before: legacyPath,
							after: "/var/jaf/uploads/packets/wo.pdf",
						},
					}),
				}),
			})
		},
	)

	it("is refused for an old-flow job already released to Finance", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...signed,
			jafInvoiceGeneratedAt: new Date(),
			jafInvoicePdfPath: "/var/jaf/uploads/jaf-invoices/doc-1.pdf",
			releasedToFinanceAt: new Date(),
		} as any)
		expect(await run()).toEqual({ errorKey: "packet.errors.locked" })
		expect(generateClaroPacketPdf).not.toHaveBeenCalled()
	})

	it("is refused when a send lands while rendering: nothing audited", async () => {
		vi.mocked(db.jafInvoice.updateMany).mockResolvedValue({ count: 0 } as any)
		expect(await run()).toEqual({ errorKey: "packet.errors.locked" })
		expect(db.auditTrail.create).not.toHaveBeenCalled()
	})

	it("nothing about the Prefield or the blueprint blocks it", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...signed,
			prefieldNeeded: true,
			claroSupervisor: {
				...CLARO,
				requiresPrefield: true,
				requiresBlueprint: true,
			},
		} as any)
		expect((await run()).status).toBe(302)
	})

	it("needs a Claro supervisor to name on the documents", async () => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue({
			...signed,
			claroSupervisorId: null,
			claroSupervisor: null,
		} as any)
		expect(await run()).toEqual({
			errorKey: "packet.errors.no_claro_supervisor",
		})
		expect(generateClaroPacketPdf).not.toHaveBeenCalled()
	})

	it("reports a render failure without storing anything", async () => {
		vi.mocked(generateClaroPacketPdf).mockRejectedValueOnce(new Error("boom"))
		expect(await run()).toEqual({ errorKey: "packet.errors.render_failed" })
		expect(db.jafInvoice.updateMany).not.toHaveBeenCalled()
	})
})

describe("review loader: step 4 work-order document", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(db.user.findUnique).mockResolvedValue({
			supervisorAreas: ["OESTE"],
		} as any)
		vi.mocked(db.photo.findMany).mockResolvedValue([])
		vi.mocked(db.preCertSheet.findFirst).mockResolvedValue(null)
		vi.mocked(db.brigade.findUnique).mockResolvedValue(null)
		vi.mocked(db.user.findMany).mockResolvedValue([])
		vi.mocked(getActiveServiceCodes).mockResolvedValue(CATALOG as any)
		vi.mocked(getAvisoAmountTolerance).mockResolvedValue(0.01)
		vi.mocked(requireRole).mockResolvedValue({
			user: { id: "sup-1", role: "SUPERVISOR", name: "Edgard Ocasio" },
			session: {},
		} as any)
	})

	const load = async (doc: Record<string, unknown>) => {
		vi.mocked(db.jafInvoice.findUniqueOrThrow).mockResolvedValue(doc as any)
		return loader({
			request: new Request("http://localhost/docs/doc-1/review?step=APPROVE"),
			params: { id: "doc-1" },
		} as any)
	}

	it("loads the document with page links, the viewer as JAF supervisor fallback", async () => {
		const { loadWorkOrderDocument } = await import("~/lib/packet-send.server")
		vi.mocked(loadWorkOrderDocument).mockResolvedValue({
			workOrderNumber: "W",
		} as any)
		const data = await load({ ...approvedDoc, brigade: { area: "OESTE" } })
		expect(loadWorkOrderDocument).toHaveBeenCalledWith("doc-1", "Edgard Ocasio")
		expect(data.workOrder).toEqual({ workOrderNumber: "W" })
	})

	it("Generate package is open once signed and until the first send", async () => {
		const signedDoc = {
			...approvedDoc,
			brigade: { area: "OESTE" },
			completionSignature: "data:image/png;base64,x",
			claroSupervisorId: "cs-1",
			claroSupervisor: {
				id: "cs-1",
				name: "Ramón Claro",
				email: "ramon@claro.example",
				requiresPrefield: false,
				requiresBlueprint: false,
			},
			ordenNumber: null,
			pedido: null,
			smr: null,
			titulo: null,
			jafInvoicePdfPath: null,
		}
		expect((await load(signedDoc)).canGeneratePdf).toBe(true)
		expect(
			(
				await load({
					...signedDoc,
					status: "FIELD_UPDATED",
					supervisorApprovedAt: null,
					completionSignature: null,
				})
			).canGeneratePdf,
		).toBe(false)
		expect(
			(
				await load({
					...signedDoc,
					jafInvoiceGeneratedAt: new Date(),
					jafInvoicePdfPath: "/uploads/packets/sent.pdf",
				})
			).canGeneratePdf,
		).toBe(false)
	})

	it("Generate package stays closed without a Claro supervisor; the Prefield and blueprint rules never close it", async () => {
		const base = {
			...approvedDoc,
			brigade: { area: "OESTE" },
			completionSignature: "data:image/png;base64,x",
			ordenNumber: null,
			pedido: null,
			smr: null,
			titulo: null,
			jafInvoicePdfPath: null,
		}
		const none = await load({
			...base,
			claroSupervisorId: null,
			claroSupervisor: null,
		})
		expect(none.canGeneratePdf).toBe(false)
		expect(none.packet.blockers).toEqual(["claro_supervisor"])
		const strict = await load({
			...base,
			claroSupervisorId: "cs-1",
			claroSupervisor: {
				id: "cs-1",
				name: "Ramón Claro",
				email: "ramon@claro.example",
				requiresPrefield: true,
				requiresBlueprint: true,
			},
		})
		expect(strict.canGeneratePdf).toBe(true)
		expect(strict.packet.blockers).toEqual(["blueprint"])
	})

	it("a job sent under the old flow (priced invoice stored) can generate its work order PDF", async () => {
		const data = await load({
			...approvedDoc,
			status: "CLARO_UPLOADED",
			brigade: { area: "OESTE" },
			completionSignature: null,
			claroSupervisorId: null,
			claroSupervisor: null,
			jafInvoiceGeneratedAt: new Date("2026-09-01T12:00:00Z"),
			jafInvoicePdfPath: "/uploads/jaf-invoices/doc-1-jaf-invoice.pdf",
		})
		expect(data.canGeneratePdf).toBe(true)
		expect(data.packet.packetHref).toBeNull()
	})
})
