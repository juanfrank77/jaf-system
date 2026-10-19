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

import { db } from "~/lib/db.server"
import { type MailTransport, setMailTransport } from "~/lib/packet-mail.server"
import { sendPacket } from "~/lib/packet-send.server"
import { generateClaroPacketPdf } from "~/lib/pdf/claro-packet.server"

// The shared shadow DB is remote and can be slow under a parallel suite run.
const HOOK_TIMEOUT = 60_000
const TAG = `pks-${Date.now()}`
const userIds: string[] = []
const docIds: string[] = []
const claroIds: string[] = []
const codeIds: string[] = []

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
})

afterAll(async () => {
	setMailTransport(null)
	await db.auditTrail.deleteMany({ where: { docId: { in: docIds } } })
	await db.packetSend.deleteMany({ where: { docId: { in: docIds } } })
	await db.jafInvoice.deleteMany({ where: { id: { in: docIds } } })
	await db.claroSupervisor.deleteMany({ where: { id: { in: claroIds } } })
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

	it("blocks on the Claro supervisor's Prefield and blueprint rules, with no row and no email", async () => {
		const claro = await seedClaro({
			requiresPrefield: true,
			requiresBlueprint: true,
		})
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		setMailTransport(okTransport)
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: false, errorKey: "packet.errors.prefield_missing" })
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: { ordenNumber: "O1", pedido: "P1", smr: "S1", titulo: "T1" },
		})
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "manual" }),
		).toEqual({ ok: false, errorKey: "packet.errors.blueprint_missing" })
		expect(await rows(doc.id)).toHaveLength(0)
		expect(sent).toHaveLength(0)
		expect((await reload(doc.id)).jafInvoiceGeneratedAt).toBeNull()
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
		const claro = await seedClaro({
			requiresPrefield: true,
		})
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			ordenNumber: "O1",
			pedido: "P1",
			smr: "S1",
			titulo: "T1",
		})
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
		expect(pdfInput.showPrefield).toBe(true)
		expect(pdfInput.claroSupervisorName).toBe(claro.name)
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

	it("after the first send, new flags do not block and a resend uses the current email", async () => {
		const claro = await seedClaro()
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		setMailTransport(okTransport)
		await sendPacket({ docId: doc.id, actor: sup, mode: "email" })

		const newEmail = `moved-${Math.random()}@claro.test`
		await db.claroSupervisor.update({
			where: { id: claro.id },
			data: {
				requiresPrefield: true,
				requiresBlueprint: true,
				email: newEmail,
			},
		})
		expect(
			await sendPacket({ docId: doc.id, actor: sup, mode: "email" }),
		).toEqual({ ok: true, outcome: "SENT" })
		const log = await rows(doc.id)
		expect(log.map((r) => r.recipientEmail)).toEqual([claro.email, newEmail])
		expect(sent[1].to).toBe(newEmail)
		// The flag turned on after the first send does not add a Prefield page.
		const resendInput = vi.mocked(generateClaroPacketPdf).mock.calls.at(-1)?.[0]
		expect(resendInput?.showPrefield).toBe(false)
	})
})
