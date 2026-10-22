import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest"

vi.mock("~/lib/pdf/claro-packet.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/pdf/claro-packet.server")>()),
	generateClaroPacketPdf: vi.fn(async () => Buffer.from("%PDF-packet")),
}))

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { extractText, getDocumentProxy } from "unpdf"
import { db } from "~/lib/db.server"
import { type MailTransport, setMailTransport } from "~/lib/packet-mail.server"
import {
	buildPacketInput,
	buildPrefieldInput,
	sendPacket,
} from "~/lib/packet-send.server"
import { generateClaroPacketPdf } from "~/lib/pdf/claro-packet.server"
import { getIvuRate } from "~/lib/system-settings.server"
import { photoFile, saveBuffer } from "~/lib/uploads.server"

// The shared shadow DB is remote and can be slow under a parallel suite run.
const HOOK_TIMEOUT = 60_000
const TAG = `pks-${Date.now()}`
const userIds: string[] = []
const docIds: string[] = []
const claroIds: string[] = []
const codeIds: string[] = []
const brigadeIds: string[] = []

type Seeded = { id: string; name: string; role: "SUPERVISOR" | "ADMIN" }
let sup: Seeded
let otherSup: Seeded
let admin: Seeded
let code1: { id: string; claroCode: string; name: string }
let code2: { id: string; claroCode: string; name: string }

async function seedUser(role: "SUPERVISOR" | "ADMIN"): Promise<Seeded> {
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
			name: `Claro ${TAG}`,
			email: `claro-${Math.random()}@claro.test`,
			...extra,
		},
	})
	claroIds.push(c.id)
	return c
}

function installed() {
	return [
		{
			serviceCodeId: code1.id,
			claroCode: code1.claroCode,
			accountCode: "610",
			name: code1.name,
			qty: 5,
		},
		{
			serviceCodeId: code2.id,
			claroCode: code2.claroCode,
			accountCode: "6102",
			name: code2.name,
			qty: 2,
		},
	]
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
			installedServiceLines: installed(),
			...extra,
		},
	})
	docIds.push(d.id)
	return d
}

const sent: Parameters<MailTransport>[0][] = []
const okTransport: MailTransport = async (m) => {
	sent.push(m)
}

const rows = (docId: string) =>
	db.packetSend.findMany({ where: { docId }, orderBy: { sentAt: "asc" } })
const reload = (docId: string) =>
	db.jafInvoice.findUniqueOrThrow({ where: { id: docId } })

beforeAll(async () => {
	sup = await seedUser("SUPERVISOR")
	otherSup = await seedUser("SUPERVISOR")
	admin = await seedUser("ADMIN")
	const c1 = await db.serviceCode.create({
		data: {
			claroCode: `${TAG}-1`,
			name: "TRANSFER ATTCH",
			kind: "SERVICE",
			unit: "EA",
			unitPrice: "10.5",
			accountCode: "610",
		},
	})
	const c2 = await db.serviceCode.create({
		data: {
			claroCode: `${TAG}-2`,
			name: "REMOCION",
			kind: "SERVICE",
			unit: "EA",
			unitPrice: "3.25",
			accountCode: "6102",
		},
	})
	codeIds.push(c1.id, c2.id)
	code1 = c1
	code2 = c2
}, HOOK_TIMEOUT)

beforeEach(() => {
	sent.length = 0
	setMailTransport(null)
	for (const k of [
		"SMTP_HOST",
		"SMTP_PORT",
		"SMTP_USER",
		"SMTP_PASSWORD",
		"SMTP_FROM",
	])
		delete process.env[k]
	vi.mocked(generateClaroPacketPdf).mockClear()
	// The email tests run with the feature on; manual-mode tests turn it off.
	process.env.PACKET_EMAIL_ENABLED = "true"
})

afterAll(async () => {
	setMailTransport(null)
	await db.auditTrail.deleteMany({ where: { docId: { in: docIds } } })
	await db.photo.deleteMany({ where: { docId: { in: docIds } } })
	await db.packetSend.deleteMany({ where: { docId: { in: docIds } } })
	await db.jafInvoice.deleteMany({ where: { id: { in: docIds } } })
	await db.claroSupervisor.deleteMany({ where: { id: { in: claroIds } } })
	await db.brigade.deleteMany({ where: { id: { in: brigadeIds } } })
	await db.serviceCode.deleteMany({ where: { id: { in: codeIds } } })
	await db.user.deleteMany({ where: { id: { in: userIds } } })
}, HOOK_TIMEOUT)

describe("sendPacket gates", { timeout: HOOK_TIMEOUT }, () => {
	it("refuses a job that is not signed off", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({
			status: "FIELD_UPDATED",
			supervisorApprovedAt: null,
			claroSupervisorId: claro.id,
		})
		setMailTransport(okTransport)
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: false, errorKey: "packet.errors.not_signed_off" })
		expect(await rows(doc.id)).toHaveLength(0)
		expect(sent).toHaveLength(0)
	})

	it("refuses a job with no Claro supervisor", async () => {
		const doc = await seedDoc()
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: false, errorKey: "packet.errors.no_claro_supervisor" })
	})

	it("refuses a job already released to Finance", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			releasedToFinanceAt: new Date(),
		})
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: false, errorKey: "packet.errors.locked" })
	})

	it.each(["email", "manual"] as const)(
		"%s: Prefield needed and no Prefield PDF yet is refused, with no row and no email",
		async (mode) => {
			if (mode === "manual") delete process.env.PACKET_EMAIL_ENABLED
			const claro = await seedClaro()
			const doc = await seedDoc({
				claroSupervisorId: claro.id,
				prefieldNeeded: true,
				jafInvoicePdfPath: "packets/stored.pdf",
			})
			setMailTransport(okTransport)
			expect(await sendPacket({ docId: doc.id, actor: sup, mode })).toEqual({
				ok: false,
				errorKey: "packet.errors.prefield_pdf_missing",
			})
			expect(await rows(doc.id)).toHaveLength(0)
			expect(sent).toHaveLength(0)
			expect((await reload(doc.id)).jafInvoiceGeneratedAt).toBeNull()
		},
	)

	it.each(["email", "manual"] as const)(
		"%s: a stale package is refused until it is generated again",
		async (mode) => {
			if (mode === "manual") delete process.env.PACKET_EMAIL_ENABLED
			const claro = await seedClaro()
			const doc = await seedDoc({
				claroSupervisorId: claro.id,
				packetStale: true,
				jafInvoicePdfPath: "packets/stored.pdf",
			})
			setMailTransport(okTransport)
			expect(await sendPacket({ docId: doc.id, actor: sup, mode })).toEqual({
				ok: false,
				errorKey: "packet.errors.package_stale",
			})
			expect(await rows(doc.id)).toHaveLength(0)
			expect(sent).toHaveLength(0)
		},
	)

	it("Prefield not needed is never gated, whatever the Claro supervisor's tag says", async () => {
		delete process.env.PACKET_EMAIL_ENABLED
		const claro = await seedClaro({ requiresPrefield: true })
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			prefieldNeeded: false,
			jafInvoicePdfPath: "packets/stored.pdf",
		})
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "manual" }),
		).toEqual({ ok: true, outcome: "MANUAL" })
	})

	it("keeps the Claro supervisor's blueprint rule", async () => {
		const claro = await seedClaro({ requiresBlueprint: true })
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		setMailTransport(okTransport)
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: false, errorKey: "packet.errors.blueprint_missing" })
		expect(sent).toHaveLength(0)
	})

	it("refuses a supervisor outside the job's scope; ADMIN may send", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		setMailTransport(okTransport)
		await expect(
			sendPacket({ docId: doc.id, actor: otherSup, mode: "email" }),
		).rejects.toBeInstanceOf(Response)
		expect(await rows(doc.id)).toHaveLength(0)
		expect(sent).toHaveLength(0)
		expect(
			await sendPacket({ docId: doc.id, actor: admin, mode: "email" }),
		).toEqual({ ok: true, outcome: "SENT" })
	})
})

describe("sendPacket outcomes", { timeout: HOOK_TIMEOUT }, () => {
	it("SENT: logs the directory email, locks the invoice lines, sets the first-send time", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		setMailTransport(okTransport)
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: true, outcome: "SENT" })

		const log = await rows(doc.id)
		expect(log).toHaveLength(1)
		expect(log[0]).toMatchObject({
			outcome: "SENT",
			recipientEmail: claro.email,
			claroSupervisorId: claro.id,
			sentById: sup.id,
			error: null,
		})
		expect(sent).toHaveLength(1)
		expect(sent[0].to).toBe(claro.email)
		expect(sent[0].attachments[0].content.toString()).toBe("%PDF-packet")
		// The issuer is JAF, in the subject, the body and the file name.
		expect(sent[0].subject).toContain("JAF")
		expect(sent[0].text).toContain("JAF")
		expect(sent[0].attachments[0].filename).toMatch(/^JAF-/)
		expect(JSON.stringify(sent[0])).not.toContain("IMS")

		const after = await reload(doc.id)
		expect(after.jafInvoiceGeneratedAt).not.toBeNull()
		expect(after.jafInvoicePdfPath).toMatch(/packets/)
		expect(after.jafInvoiceLines).toEqual([
			{
				serviceCodeId: code1.id,
				claroCode: code1.claroCode,
				accountCode: "610",
				name: code1.name,
				qty: 5,
				unit: "EA",
				unitPrice: 10.5,
				lineAmount: 52.5,
			},
			{
				serviceCodeId: code2.id,
				claroCode: code2.claroCode,
				accountCode: "6102",
				name: code2.name,
				qty: 2,
				unit: "EA",
				unitPrice: 3.25,
				lineAmount: 6.5,
			},
		])
		expect(Number(after.jafInvoiceLineTotal)).toBe(59)

		const pdfInput = vi.mocked(generateClaroPacketPdf).mock.calls[0][0]
		expect(pdfInput.document).not.toHaveProperty("prefield")
		expect(pdfInput.showPickupSignatures).toBe(true)
		expect(pdfInput.document.claroSupervisor).toBe(claro.name)
		expect(JSON.stringify(pdfInput)).not.toMatch(/unitPrice|lineAmount/)

		const audit = await db.auditTrail.findMany({
			where: { docId: doc.id, action: "PACKET_SENT" },
		})
		expect(audit).toHaveLength(1)
	})

	it("FAILED: logs the error and does not advance the job", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		setMailTransport(async () => {
			throw new Error("connection refused")
		})
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: true, outcome: "FAILED" })
		const log = await rows(doc.id)
		expect(log).toHaveLength(1)
		expect(log[0].outcome).toBe("FAILED")
		expect(log[0].error).toContain("connection refused")
		const after = await reload(doc.id)
		expect(after.jafInvoiceGeneratedAt).toBeNull()
		expect(after.jafInvoiceLines).toBeNull()
		expect(
			await db.auditTrail.count({
				where: { docId: doc.id, action: "PACKET_SENT" },
			}),
		).toBe(1)
	})

	it("UNCONFIGURED does not advance; MANUAL then counts as the first send", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: true, outcome: "UNCONFIGURED" })
		const mid = await reload(doc.id)
		expect(mid.jafInvoiceGeneratedAt).toBeNull()
		// The supervisor can download the packet to send it by hand.
		expect(mid.jafInvoicePdfPath).toMatch(/packets/)

		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "manual" }),
		).toEqual({ ok: true, outcome: "MANUAL" })
		expect((await rows(doc.id)).map((r) => r.outcome)).toEqual([
			"UNCONFIGURED",
			"MANUAL",
		])
		const after = await reload(doc.id)
		expect(after.jafInvoiceGeneratedAt).not.toBeNull()
		expect(Number(after.jafInvoiceLineTotal)).toBe(59)
	})

	it("a resend adds a row and never moves the first-send time or the locked lines", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		setMailTransport(okTransport)
		await sendPacket({ docId: doc.id, actor: sup, mode: "email" })
		const first = await reload(doc.id)

		await db.jafInvoice.update({
			where: { id: doc.id },
			data: {
				installedServiceLines: [{ ...installed()[0], qty: 99 }],
			},
		})
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: true, outcome: "SENT" })
		const second = await reload(doc.id)
		expect(await rows(doc.id)).toHaveLength(2)
		expect(second.jafInvoiceGeneratedAt?.getTime()).toBe(
			first.jafInvoiceGeneratedAt?.getTime(),
		)
		expect(second.jafInvoiceLines).toEqual(first.jafInvoiceLines)
		expect(Number(second.jafInvoiceLineTotal)).toBe(59)
	})

	it("a failed resend logs FAILED and keeps the packet Claro already has", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		setMailTransport(okTransport)
		await sendPacket({ docId: doc.id, actor: sup, mode: "email" })
		const first = await reload(doc.id)
		setMailTransport(async () => {
			throw new Error("mailbox full")
		})
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: true, outcome: "FAILED" })
		const after = await reload(doc.id)
		expect((await rows(doc.id)).map((r) => r.outcome)).toEqual([
			"SENT",
			"FAILED",
		])
		expect(after.jafInvoicePdfPath).toBe(first.jafInvoicePdfPath)
		expect(after.jafInvoiceGeneratedAt?.getTime()).toBe(
			first.jafInvoiceGeneratedAt?.getTime(),
		)
	})

	it("a PDF that fails to render logs FAILED and returns render_failed", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		setMailTransport(okTransport)
		vi.mocked(generateClaroPacketPdf).mockRejectedValueOnce(
			new Error("font load failed token=abc123"),
		)
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: false, errorKey: "packet.errors.render_failed" })
		const log = await rows(doc.id)
		expect(log).toHaveLength(1)
		expect(log[0]).toMatchObject({
			outcome: "FAILED",
			recipientEmail: claro.email,
		})
		expect(log[0].error).toContain("font load failed")
		expect(log[0].error).not.toContain("abc123")
		expect(sent).toHaveLength(0)
		const after = await reload(doc.id)
		expect(after.jafInvoiceGeneratedAt).toBeNull()
		expect(after.jafInvoicePdfPath).toBeNull()
	})

	it("a double-click sets the first-send time once", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		setMailTransport(okTransport)
		const results = await Promise.all([
			sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
			sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		])
		expect(results).toEqual([
			{ ok: true, outcome: "SENT" },
			{ ok: true, outcome: "SENT" },
		])
		expect(await rows(doc.id)).toHaveLength(2)
		const audit = await db.auditTrail.findMany({
			where: { docId: doc.id, action: "PACKET_SENT" },
		})
		expect(
			audit.filter(
				(a) => (a.diffJson as { firstSend?: boolean }).firstSend === true,
			),
		).toHaveLength(1)
		expect((await reload(doc.id)).jafInvoiceGeneratedAt).not.toBeNull()
	})

	it("after the first send nothing gates a resend, and it uses the current email", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		setMailTransport(okTransport)
		await sendPacket({ docId: doc.id, actor: sup, mode: "email" })

		const newEmail = `moved-${Math.random()}@claro.test`
		await db.claroSupervisor.update({
			where: { id: claro.id },
			data: { requiresBlueprint: true, email: newEmail },
		})
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: { prefieldNeeded: true, packetStale: true },
		})
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: true, outcome: "SENT" })
		const log = await rows(doc.id)
		expect(log.map((r) => r.recipientEmail)).toEqual([claro.email, newEmail])
		expect(sent[1].to).toBe(newEmail)
	})

	it("email attaches the work order PDF, the Prefield PDF and every original photo and blueprint, each its own file", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		const prefieldPdf = await saveBuffer(
			"packets",
			`${doc.id}-prefield-${Date.now()}.pdf`,
			Buffer.from("%PDF-prefield"),
		)
		const blueprintDir = path.join(
			process.env.UPLOAD_DIR as string,
			"blueprints",
			doc.id,
		)
		await mkdir(blueprintDir, { recursive: true })
		const plan = path.join(blueprintDir, "plano.pdf")
		await writeFile(plan, "%PDF-plan")
		const photoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9])
		for (const [name, takenAt] of [
			["after.jpg", "2026-10-19T12:00:00Z"],
			["before.png", "2026-10-19T09:00:00Z"],
		] as const) {
			const file = photoFile(doc.id, name)
			await mkdir(path.dirname(file), { recursive: true })
			await writeFile(file, photoBytes)
			await db.photo.create({
				data: {
					docId: doc.id,
					uploadedById: sup.id,
					localPath: file,
					takenAt: new Date(takenAt),
				},
			})
		}
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: {
				prefieldNeeded: true,
				prefieldPdfPath: prefieldPdf,
				blueprintPaths: [plan, path.join(blueprintDir, "missing.pdf")],
			},
		})
		setMailTransport(okTransport)
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: true, outcome: "SENT" })
		const files = sent[0].attachments.map((a) => a.filename)
		expect(files).toEqual([
			`JAF-work-order-${doc.controlNumber}.pdf`,
			`JAF-prefield-${doc.controlNumber}.pdf`,
			"before.png",
			"after.jpg",
			"plano.pdf",
		])
		expect(sent[0].attachments[1].content.toString()).toBe("%PDF-prefield")
		// Originals, never converted.
		expect(sent[0].attachments[2].content.equals(photoBytes)).toBe(true)
		expect(sent[0].attachments[4].content.toString()).toBe("%PDF-plan")
	})

	it("email leaves a stored Prefield PDF out when the job does not need one", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			prefieldNeeded: false,
			prefieldPdfPath: "/nowhere/packets/x-prefield-1.pdf",
		})
		setMailTransport(okTransport)
		await sendPacket({ docId: doc.id, actor: sup, mode: "email" })
		expect(sent[0].attachments.map((a) => a.filename)).toEqual([
			`JAF-work-order-${doc.controlNumber}.pdf`,
		])
	})
})

describe("sendPacket: brigade's stock and the IVU snapshot", {
	timeout: HOOK_TIMEOUT,
}, () => {
	it("prints every Source's rows on the work order; only warehouse use is billed", async () => {
		const own = await db.serviceCode.create({
			data: {
				claroCode: `${TAG}-BRIGADE`,
				name: "OWN CLAMP",
				kind: "MATERIAL",
				unit: "EA",
				unitPrice: "1",
			},
		})
		codeIds.push(own.id)
		const claro = await seedClaro()
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			materialsTaken: [{ serviceCodeId: code1.id, qty: 10 }],
			fieldMaterials: [
				{
					serviceCodeId: code1.id,
					used: 6,
					returned: 4,
					source: "WAREHOUSE_ISSUE",
				},
				{
					serviceCodeId: own.id,
					used: 4,
					returned: 0,
					source: "TRUCK_STOCK",
				},
			],
		})
		setMailTransport(okTransport)
		const res = await sendPacket({ docId: doc.id, actor: sup, mode: "email" })
		expect(res).toEqual({ ok: true, outcome: "SENT" })
		const input = vi.mocked(generateClaroPacketPdf).mock.calls[0][0]
		expect(input.document.materials).toEqual([
			{ name: code1.name, used: 6, unit: "EA", source: "WAREHOUSE_ISSUE" },
			{ name: "OWN CLAMP", used: 4, unit: "EA", source: "TRUCK_STOCK" },
		])
		// The real renderer prints both rows with their Source.
		const real = await vi.importActual<
			typeof import("~/lib/pdf/claro-packet.server")
		>("~/lib/pdf/claro-packet.server")
		const pdf = await real.generateClaroPacketPdf(input)
		const { text } = await extractText(
			await getDocumentProxy(new Uint8Array(pdf)),
			{ mergePages: true },
		)
		expect(text).toContain("OWN CLAMP")
		expect(text).toContain("Truck stock")
		expect(text).not.toMatch(/[$€]/)
		// Only warehouse use is billed: the locked lines are the services.
		const after = await reload(doc.id)
		expect(
			(after.jafInvoiceLines as { serviceCodeId: string }[]).map(
				(l) => l.serviceCodeId,
			),
		).toEqual([code1.id, code2.id])
	})

	it("records the IVU rate on the first send only", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			jafInvoicePdfPath: "packets/stored.pdf",
		})
		await sendPacket({ docId: doc.id, actor: sup, mode: "manual" })
		await sendPacket({ docId: doc.id, actor: sup, mode: "manual" })
		const audits = await db.auditTrail.findMany({
			where: { docId: doc.id, action: "PACKET_SENT" },
			orderBy: { timestamp: "asc" },
		})
		const diffs = audits.map((a) => a.diffJson as Record<string, unknown>)
		expect(diffs[0].ivuRate).toBe(await getIvuRate())
		expect(diffs[1]).not.toHaveProperty("ivuRate")
	})
})

describe("buildPacketInput", { timeout: HOOK_TIMEOUT }, () => {
	async function seedBrigade(name: string, code: string | null) {
		const b = await db.brigade.create({
			data: { name, code, memberIds: [] },
		})
		brigadeIds.push(b.id)
		return b
	}

	it("builds the work order from stored data: every crew, pending signatures, JAF supervisor", async () => {
		const claro = await seedClaro()
		const lead = await seedBrigade(`LEAD ${TAG}`, `${TAG}-L`)
		const other = await seedBrigade(`OTHER ${TAG}`, null)
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			brigadeId: lead.id,
			crewAssignmentHistory: [{ userIds: [], brigadeIds: [lead.id, other.id] }],
			completionSignature: "data:image/png;base64,iVBORw0KGgo=",
			direccion1: "Calle 1",
			sector: "Bo. Centro",
		})
		const input = await buildPacketInput(doc.id)
		const d = input.document
		expect(d.workOrderNumber).toBe(doc.controlNumber)
		expect(d.claroSupervisor).toBe(claro.name)
		expect(d.jafSupervisor).toBe(sup.name)
		expect(d.crews).toEqual([
			{ name: lead.name, contractNumber: lead.code },
			{ name: other.name, contractNumber: null },
		])
		expect(d.address).toBe("Bo. Centro, Calle 1")
		expect(d.services.map((l) => l.qty)).toEqual([5, 2])
		expect(d).not.toHaveProperty("prefield")
		expect(d).not.toHaveProperty("blueprint")
		expect(d).not.toHaveProperty("photos")
		expect(d.materialsFromWarehouse).toBe(true)
		expect(input.showPickupSignatures).toBe(true)
		expect(d.signatures).toEqual({
			supervisor: {
				name: sup.name,
				image: "data:image/png;base64,iVBORw0KGgo=",
			},
			warehouse: "pending",
			crew: "pending",
		})
		expect(input.issuedOn).toBeInstanceOf(Date)
		expect(JSON.stringify(input)).not.toMatch(/unitPrice|lineAmount|price/i)
	})

	it("a no-warehouse job prints its reason and no pickup signatures", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			materialsFromWarehouse: false,
			materialsReason: "own truck",
		})
		const input = await buildPacketInput(doc.id)
		expect(input.showPickupSignatures).toBe(false)
		expect(input.document.materialsReason).toBe("own truck")
	})
})

describe("buildPrefieldInput", { timeout: HOOK_TIMEOUT }, () => {
	it("fills in JAF's part: number, address, title, supervisor, Dept # from their area, Claro supervisor", async () => {
		const claro = await seedClaro()
		await db.user.update({
			where: { id: sup.id },
			data: { supervisorAreas: ["OESTE", "SUR"] },
		})
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			jobDescription: "Poste nuevo",
			direccion1: "Calle 1",
			sector: "Bo. Centro",
		})
		const input = await buildPrefieldInput(doc.id)
		expect(input).toEqual({
			workOrderNumber: doc.controlNumber,
			address: "Bo. Centro, Calle 1",
			title: "Poste nuevo",
			jafSupervisor: sup.name,
			deptNumber: "OESTE",
			claroSupervisor: claro.name,
			issuedOn: expect.any(Date),
		})
		await db.user.update({
			where: { id: sup.id },
			data: { supervisorAreas: [] },
		})
		expect((await buildPrefieldInput(doc.id)).deptNumber).toBeNull()
	})
})

describe("sendPacket: manual-only step 5", { timeout: HOOK_TIMEOUT }, () => {
	it("refuses an email send while PACKET_EMAIL_ENABLED is off, sending and logging nothing", async () => {
		delete process.env.PACKET_EMAIL_ENABLED
		const claro = await seedClaro()
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			jafInvoicePdfPath: "packets/stored.pdf",
		})
		setMailTransport(okTransport)
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: false, errorKey: "packet.errors.email_disabled" })
		expect(sent).toHaveLength(0)
		expect(await rows(doc.id)).toHaveLength(0)
		expect(vi.mocked(generateClaroPacketPdf)).not.toHaveBeenCalled()
	})

	it("manual send reuses the stored PDF: MANUAL row, PACKET_SENT audit, first-send time, no re-render", async () => {
		delete process.env.PACKET_EMAIL_ENABLED
		const claro = await seedClaro()
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			jafInvoicePdfPath: "packets/stored.pdf",
		})
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "manual" }),
		).toEqual({ ok: true, outcome: "MANUAL" })
		expect(vi.mocked(generateClaroPacketPdf)).not.toHaveBeenCalled()
		expect((await rows(doc.id)).map((r) => r.outcome)).toEqual(["MANUAL"])
		const after = await reload(doc.id)
		expect(after.jafInvoiceGeneratedAt).not.toBeNull()
		expect(after.jafInvoicePdfPath).toBe("packets/stored.pdf")
		const audit = await db.auditTrail.findMany({
			where: { docId: doc.id, action: "PACKET_SENT" },
		})
		expect(audit).toHaveLength(1)
		expect(audit[0].diffJson).toMatchObject({
			mode: "manual",
			outcome: "MANUAL",
			path: "packets/stored.pdf",
			firstSend: true,
		})
		// A resend keeps the stored file too.
		await sendPacket({ docId: doc.id, actor: sup, mode: "manual" })
		expect((await reload(doc.id)).jafInvoicePdfPath).toBe("packets/stored.pdf")
		expect(vi.mocked(generateClaroPacketPdf)).not.toHaveBeenCalled()
	})

	it("manual send with no stored PDF returns pdf_missing and changes nothing", async () => {
		delete process.env.PACKET_EMAIL_ENABLED
		const claro = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "manual" }),
		).toEqual({ ok: false, errorKey: "packet.errors.pdf_missing" })
		expect(await rows(doc.id)).toHaveLength(0)
		expect((await reload(doc.id)).jafInvoiceGeneratedAt).toBeNull()
	})

	it("an old priced invoice is not the step 4 PDF: manual send returns pdf_missing", async () => {
		delete process.env.PACKET_EMAIL_ENABLED
		const claro = await seedClaro()
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			jafInvoicePdfPath: "/uploads/jaf-invoices/doc-jaf-invoice.pdf",
		})
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "manual" }),
		).toEqual({ ok: false, errorKey: "packet.errors.pdf_missing" })
		expect(await rows(doc.id)).toHaveLength(0)
		expect((await reload(doc.id)).jafInvoiceGeneratedAt).toBeNull()
	})
})
