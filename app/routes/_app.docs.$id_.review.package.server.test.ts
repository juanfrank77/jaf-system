import { redirect } from "react-router"
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest"

// Step 4 · Generate package and step 5 · Packet → Claro, against the real DB
// and the real sendPacket (only the PDF renders and the mail transport are
// fakes): the package files, the Prefield-PDF send gate, and the Claro
// supervisor / blueprint details editable until the first send.
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/pdf/claro-packet.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/pdf/claro-packet.server")>()),
	generateClaroPacketPdf: vi.fn(async () => Buffer.from("%PDF-packet")),
}))
vi.mock("~/lib/pdf/claro-prefield.server", () => ({
	generateClaroPrefieldPdf: vi.fn(async () => Buffer.from("%PDF-prefield")),
}))

import { readFile } from "node:fs/promises"
import { db } from "~/lib/db.server"
import { type MailTransport, setMailTransport } from "~/lib/packet-mail.server"
import { generateClaroPrefieldPdf } from "~/lib/pdf/claro-prefield.server"
import { requireRole } from "~/lib/permissions.server"
import { action, loader } from "./_app.docs.$id_.review"

const SIG = "data:image/png;base64,iVBORw0KGgo="

const HOOK_TIMEOUT = 60_000
const TAG = `pfx-${Date.now()}`
const userIds: string[] = []
const docIds: string[] = []
const claroIds: string[] = []
const codeIds: string[] = []

type Seeded = { id: string; name: string; role: "SUPERVISOR" | "ADMIN" }
let sup: Seeded
let otherSup: Seeded
let admin: Seeded
let code: { id: string; claroCode: string; name: string }

async function seedUser(role: Seeded["role"]): Promise<Seeded> {
	const u = await db.user.create({
		data: {
			email: `${TAG}-${Math.random()}@x.test`,
			name: `${role} ${TAG}`,
			role,
		},
	})
	userIds.push(u.id)
	return { id: u.id, name: u.name, role }
}

async function seedClaro(extra: Record<string, unknown> = {}) {
	const c = await db.claroSupervisor.create({
		data: {
			name: `Claro ${TAG} ${Math.random()}`,
			email: `claro-${Math.random()}@claro.test`,
			...extra,
		},
	})
	claroIds.push(c.id)
	return c
}

async function seedDoc(extra: Record<string, unknown> = {}) {
	const now = new Date()
	const d = await db.jafInvoice.create({
		data: {
			controlNumber: `${TAG}-${Math.random()}`,
			jobType: "Mantenimiento",
			jobAddressEstimated: "Calle 1, Sector",
			estimatedMaterials: [],
			supervisorId: sup.id,
			status: "SUPERVISOR_APPROVED",
			supervisorApprovedAt: now,
			completedById: sup.id,
			completionSignedAt: now,
			completionSignature: SIG,
			installedServiceLines: [
				{
					serviceCodeId: code.id,
					claroCode: code.claroCode,
					accountCode: "610",
					name: code.name,
					qty: 3,
				},
			],
			...extra,
		},
	})
	docIds.push(d.id)
	return d
}

function as(user: Seeded) {
	vi.mocked(requireRole).mockImplementation(async (_req, roles) => {
		if (!(roles as string[]).includes(user.role)) throw redirect("/dashboard")
		return { user, session: {} } as any
	})
}

function post(docId: string, fields: Record<string, string | File>) {
	const form = new FormData()
	for (const [k, v] of Object.entries(fields)) form.set(k, v)
	return new Request(`http://localhost/docs/${docId}/review`, {
		method: "POST",
		body: form,
	})
}

async function run(docId: string, fields: Record<string, string | File>) {
	try {
		return await action({
			request: post(docId, fields),
			params: { id: docId },
		} as any)
	} catch (e) {
		if (e instanceof Response) return e
		throw e
	}
}

async function load(docId: string) {
	return loader({
		request: new Request(`http://localhost/docs/${docId}/review`),
		params: { id: docId },
	} as any)
}

const okTransport: MailTransport = async () => {}

beforeAll(async () => {
	sup = await seedUser("SUPERVISOR")
	otherSup = await seedUser("SUPERVISOR")
	admin = await seedUser("ADMIN")
	const c = await db.serviceCode.create({
		data: {
			claroCode: `${TAG}-1`,
			name: "TRANSFER ATTCH",
			kind: "SERVICE",
			unit: "EA",
			unitPrice: "10.5",
			accountCode: "610",
		},
	})
	codeIds.push(c.id)
	code = c
}, HOOK_TIMEOUT)

beforeEach(() => {
	vi.mocked(generateClaroPrefieldPdf).mockClear()
	setMailTransport(okTransport)
	// These tests exercise the email send path, which is opt-in.
	process.env.PACKET_EMAIL_ENABLED = "true"
})

afterAll(async () => {
	delete process.env.PACKET_EMAIL_ENABLED
	setMailTransport(null)
	await db.auditTrail.deleteMany({ where: { docId: { in: docIds } } })
	await db.packetSend.deleteMany({ where: { docId: { in: docIds } } })
	await db.jafInvoice.deleteMany({ where: { id: { in: docIds } } })
	await db.claroSupervisor.deleteMany({ where: { id: { in: claroIds } } })
	await db.serviceCode.deleteMany({ where: { id: { in: codeIds } } })
	await db.user.deleteMany({ where: { id: { in: userIds } } })
}, HOOK_TIMEOUT)

const reload = (docId: string) =>
	db.jafInvoice.findUniqueOrThrow({ where: { id: docId } })

describe("review: generate_package (step 4)", { timeout: HOOK_TIMEOUT }, () => {
	it("Prefield needed: stores the work order PDF and the Prefield PDF, clears stale, audits both; then the send goes", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			prefieldNeeded: true,
			packetStale: true,
			jafInvoicePdfPath: "/old/packets/old-work-order.pdf",
		})
		as(sup)
		expect((await load(doc.id)).packet.blockers).toEqual([
			"prefield_pdf",
			"stale",
		])
		expect(await run(doc.id, { intent: "send_packet" })).toEqual({
			errorKey: "packet.errors.prefield_pdf_missing",
		})

		const res = await run(doc.id, { intent: "generate_package" })
		expect(res).toBeInstanceOf(Response)
		expect((res as Response).headers.get("Location")).toBe(
			`/docs/${doc.id}/review?step=APPROVE`,
		)
		const after = await reload(doc.id)
		expect(after.jafInvoicePdfPath).toMatch(
			new RegExp(`packets/${doc.id}-work-order-\\d+\\.pdf$`),
		)
		expect(after.prefieldPdfPath).toMatch(
			new RegExp(`packets/${doc.id}-prefield-\\d+\\.pdf$`),
		)
		expect(after.packetStale).toBe(false)
		expect((await readFile(after.prefieldPdfPath as string)).toString()).toBe(
			"%PDF-prefield",
		)
		expect(vi.mocked(generateClaroPrefieldPdf)).toHaveBeenCalledWith(
			expect.objectContaining({
				workOrderNumber: doc.controlNumber,
				claroSupervisor: claro.name,
				jafSupervisor: sup.name,
			}),
		)
		const audit = await db.auditTrail.findFirst({
			where: { docId: doc.id, action: "WORK_ORDER_PDF_GENERATED" },
		})
		expect(audit?.userId).toBe(sup.id)
		expect(audit?.diffJson).toMatchObject({
			jafInvoicePdfPath: {
				before: "/old/packets/old-work-order.pdf",
				after: after.jafInvoicePdfPath,
			},
			prefieldPdfPath: { before: null, after: after.prefieldPdfPath },
			packetStale: { before: true, after: false },
			prefieldGenerated: true,
		})

		const step5 = (await load(doc.id)).packet
		expect(step5.blockers).toEqual([])
		expect(step5.files.map((f) => f.key)).toEqual([
			"work_order_pdf",
			"prefield_pdf",
		])
		expect(step5.zipHref).toBe(`/docs/${doc.id}/package`)
		expect(await run(doc.id, { intent: "send_packet" })).toBeInstanceOf(
			Response,
		)
		expect((await reload(doc.id)).jafInvoiceGeneratedAt).not.toBeNull()
	})

	it("Prefield not needed: stores only the work order PDF", async () => {
		const claro = await seedClaro({ requiresPrefield: true })
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			prefieldNeeded: false,
		})
		as(sup)
		await run(doc.id, { intent: "generate_package" })
		const after = await reload(doc.id)
		expect(after.jafInvoicePdfPath).toMatch(/packets/)
		expect(after.prefieldPdfPath).toBeNull()
		expect(vi.mocked(generateClaroPrefieldPdf)).not.toHaveBeenCalled()
		const audit = await db.auditTrail.findFirst({
			where: { docId: doc.id, action: "WORK_ORDER_PDF_GENERATED" },
		})
		expect(audit?.diffJson).toMatchObject({ prefieldGenerated: false })
		expect((await load(doc.id)).packet.files.map((f) => f.key)).toEqual([
			"work_order_pdf",
		])
	})

	it("is refused once the package was sent: what Claro has never changes", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			prefieldNeeded: true,
			jafInvoiceGeneratedAt: new Date(),
			jafInvoicePdfPath: "/u/packets/sent.pdf",
		})
		as(sup)
		expect(await run(doc.id, { intent: "generate_package" })).toEqual({
			errorKey: "packet.errors.locked",
		})
		const after = await reload(doc.id)
		expect(after.jafInvoicePdfPath).toBe("/u/packets/sent.pdf")
		expect(after.prefieldPdfPath).toBeNull()
	})
})

describe("review: save_packet_details", { timeout: HOOK_TIMEOUT }, () => {
	it("takes no Prefield fields: those are Claro's boxes", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		as(sup)
		for (const intent of ["save_packet_details", "save_prefield"])
			await run(doc.id, {
				intent,
				claroSupervisorId: claro.id,
				ordenNumber: "4410",
				pedido: "P-77",
				smr: "SMR-9",
				titulo: "Poste nuevo",
			})
		const after = await reload(doc.id)
		expect(after).toMatchObject({
			ordenNumber: null,
			pedido: null,
			smr: null,
			titulo: null,
		})
		expect(
			await db.auditTrail.count({
				where: { docId: doc.id, action: "PREFIELD_EDITED" },
			}),
		).toBe(0)
	})

	it("can change the Claro supervisor: it clears the generated files (audited)", async () => {
		const strict = await seedClaro({ requiresBlueprint: true })
		const relaxed = await seedClaro()
		const doc = await seedDoc({
			claroSupervisorId: strict.id,
			prefieldNeeded: true,
			jafInvoicePdfPath: "packets/stored.pdf",
			prefieldPdfPath: "packets/stored-prefield.pdf",
		})
		as(sup)
		await run(doc.id, {
			intent: "save_packet_details",
			claroSupervisorId: strict.id,
		})
		expect((await reload(doc.id)).jafInvoicePdfPath).toBe("packets/stored.pdf")

		await run(doc.id, {
			intent: "save_packet_details",
			claroSupervisorId: relaxed.id,
		})
		const after = await reload(doc.id)
		expect(after).toMatchObject({
			claroSupervisorId: relaxed.id,
			jafInvoicePdfPath: null,
			prefieldPdfPath: null,
		})
		const audit = await db.auditTrail.findFirst({
			where: { docId: doc.id, action: "PREFIELD_EDITED" },
		})
		expect(audit?.userId).toBe(sup.id)
		expect(audit?.diffJson).toMatchObject({
			claroSupervisorId: { before: strict.id, after: relaxed.id },
			jafInvoicePdfPath: { before: "packets/stored.pdf", after: null },
			prefieldPdfPath: { before: "packets/stored-prefield.pdf", after: null },
		})
		expect((await load(doc.id)).packet.packetHref).toBeNull()
	})

	it("keeps a deactivated Claro supervisor selectable for its own job, but refuses switching to another inactive one", async () => {
		const retired = await seedClaro({ active: false })
		const otherRetired = await seedClaro({ active: false })
		const doc = await seedDoc({ claroSupervisorId: retired.id })
		as(sup)

		const options = (await load(doc.id)).packet.claroOptions.map((o) => o.id)
		expect(options).toContain(retired.id)
		expect(options).not.toContain(otherRetired.id)

		const kept = await run(doc.id, {
			intent: "save_packet_details",
			claroSupervisorId: retired.id,
		})
		expect(kept).toBeInstanceOf(Response)
		expect(
			await run(doc.id, {
				intent: "save_packet_details",
				claroSupervisorId: otherRetired.id,
			}),
		).toEqual({ errorKey: "packet.errors.claro_supervisor_invalid" })
		expect((await reload(doc.id)).claroSupervisorId).toBe(retired.id)
	})

	it("adds a blueprint when the Claro supervisor requires one, and refuses a bad file; the original is listed for Claro", async () => {
		const claro = await seedClaro({ requiresBlueprint: true })
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			jafInvoicePdfPath: "packets/stored.pdf",
		})
		as(sup)
		expect((await load(doc.id)).packet.blockers).toEqual(["blueprint"])

		expect(
			await run(doc.id, {
				intent: "save_packet_details",
				claroSupervisorId: claro.id,
				blueprint: new File(["x"], "plano.exe", {
					type: "application/octet-stream",
				}),
			}),
		).toEqual({ errorKey: "docs_field.errors.blueprint_invalid" })

		await run(doc.id, {
			intent: "save_packet_details",
			claroSupervisorId: claro.id,
			blueprint: new File(["%PDF-1.4"], "plano 1.pdf", {
				type: "application/pdf",
			}),
		})
		const after = await reload(doc.id)
		expect(after.blueprintPaths).toHaveLength(1)
		expect(after.blueprintPaths[0]).toMatch(/plano_1\.pdf$/)
		// A blueprint travels as its own file: the generated PDF still stands.
		expect(after.jafInvoicePdfPath).toBe("packets/stored.pdf")
		const step5 = (await load(doc.id)).packet
		expect(step5.blockers).toEqual([])
		const listed = step5.files.at(-1)
		expect(listed?.key).toBe("blueprint")
		expect(listed?.name).toMatch(/plano_1\.pdf$/)
		expect(listed?.href).toBe(
			`/files/blueprints/${doc.id}/${encodeURIComponent(listed?.name ?? "")}`,
		)
	})

	it("is refused after the first send", async () => {
		const claro = await seedClaro()
		const other = await seedClaro()
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			jafInvoiceGeneratedAt: new Date(),
		})
		as(sup)
		expect(
			await run(doc.id, {
				intent: "save_packet_details",
				claroSupervisorId: other.id,
			}),
		).toEqual({ errorKey: "packet.errors.prefield_locked" })
		expect((await reload(doc.id)).claroSupervisorId).toBe(claro.id)
	})

	it("an out-of-scope supervisor is refused and nothing is written", async () => {
		const claro = await seedClaro()
		const other = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		as(otherSup)
		const res = await run(doc.id, {
			intent: "save_packet_details",
			claroSupervisorId: other.id,
		})
		expect(res).toBeInstanceOf(Response)
		expect((res as Response).headers.get("Location")).toBe("/dashboard")
		expect((await reload(doc.id)).claroSupervisorId).toBe(claro.id)
	})

	it("Admin may change it too", async () => {
		const claro = await seedClaro()
		const other = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		as(admin)
		await run(doc.id, {
			intent: "save_packet_details",
			claroSupervisorId: other.id,
		})
		expect((await reload(doc.id)).claroSupervisorId).toBe(other.id)
	})
})
