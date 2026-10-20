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

// Step 5 · Packet → Claro: the Prefield fields and the Claro supervisor are
// editable on the packet step until the first send, against the real DB and
// the real sendPacket (only the PDF render and the mail transport are fakes).
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/pdf/claro-packet.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/pdf/claro-packet.server")>()),
	generateClaroPacketPdf: vi.fn(async () => Buffer.from("%PDF-packet")),
}))

import { db } from "~/lib/db.server"
import { type MailTransport, setMailTransport } from "~/lib/packet-mail.server"
import { requireRole } from "~/lib/permissions.server"
import { action, loader } from "./_app.docs.$id_.review"

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

describe("review: save_prefield", { timeout: HOOK_TIMEOUT }, () => {
	it("a blocked requires-Prefield job is filled on the packet step and then sends", async () => {
		const claro = await seedClaro({ requiresPrefield: true })
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		as(sup)

		expect((await load(doc.id)).packet.blockers).toEqual(["prefield"])
		expect(await run(doc.id, { intent: "send_packet" })).toEqual({
			errorKey: "packet.errors.prefield_missing",
		})

		const saved = await run(doc.id, {
			intent: "save_prefield",
			claroSupervisorId: claro.id,
			avisoNumber: "",
			ordenNumber: " 4410 ",
			pedido: "P-77",
			smr: "SMR-9",
			titulo: "Poste nuevo",
		})
		expect(saved).toBeInstanceOf(Response)
		const after = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(after).toMatchObject({
			ordenNumber: "4410",
			pedido: "P-77",
			smr: "SMR-9",
			titulo: "Poste nuevo",
			avisoNumber: null,
		})
		const audit = await db.auditTrail.findFirst({
			where: { docId: doc.id, action: "PREFIELD_EDITED" },
		})
		expect(audit?.userId).toBe(sup.id)
		expect((await load(doc.id)).packet.blockers).toEqual([])

		const sent = await run(doc.id, { intent: "send_packet" })
		expect(sent).toBeInstanceOf(Response)
		const final = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(final.jafInvoiceGeneratedAt).not.toBeNull()
	})

	it("stores blanks as null and can change the Claro supervisor, even to clear a requirement", async () => {
		const strict = await seedClaro({ requiresPrefield: true })
		const relaxed = await seedClaro()
		const doc = await seedDoc({
			claroSupervisorId: strict.id,
			ordenNumber: "OLD",
			pedido: "OLD",
		})
		as(sup)
		await run(doc.id, {
			intent: "save_prefield",
			claroSupervisorId: relaxed.id,
			avisoNumber: "   ",
			ordenNumber: "",
			pedido: "  ",
			smr: "",
			titulo: "",
		})
		const after = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(after).toMatchObject({
			claroSupervisorId: relaxed.id,
			avisoNumber: null,
			ordenNumber: null,
			pedido: null,
			smr: null,
			titulo: null,
		})
		expect((await load(doc.id)).packet.blockers).toEqual([])
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
			intent: "save_prefield",
			claroSupervisorId: retired.id,
			ordenNumber: "1",
		})
		expect(kept).toBeInstanceOf(Response)
		expect(
			await run(doc.id, {
				intent: "save_prefield",
				claroSupervisorId: otherRetired.id,
			}),
		).toEqual({ errorKey: "packet.errors.claro_supervisor_invalid" })
		const after = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(after.claroSupervisorId).toBe(retired.id)
		expect(after.ordenNumber).toBe("1")
	})

	it("adds a blueprint when the Claro supervisor requires one, and refuses a bad file", async () => {
		const claro = await seedClaro({ requiresBlueprint: true })
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		as(sup)
		expect((await load(doc.id)).packet.blockers).toEqual(["blueprint"])

		expect(
			await run(doc.id, {
				intent: "save_prefield",
				claroSupervisorId: claro.id,
				blueprint: new File(["x"], "plano.exe", {
					type: "application/octet-stream",
				}),
			}),
		).toEqual({ errorKey: "docs_field.errors.blueprint_invalid" })

		await run(doc.id, {
			intent: "save_prefield",
			claroSupervisorId: claro.id,
			blueprint: new File(["%PDF-1.4"], "plano 1.pdf", {
				type: "application/pdf",
			}),
		})
		const after = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(after.blueprintPaths).toHaveLength(1)
		expect(after.blueprintPaths[0]).toMatch(/plano_1\.pdf$/)
		expect((await load(doc.id)).packet.blockers).toEqual([])
	})

	it("is refused after the first send", async () => {
		const claro = await seedClaro()
		const sentAt = new Date()
		const doc = await seedDoc({
			claroSupervisorId: claro.id,
			jafInvoiceGeneratedAt: sentAt,
			ordenNumber: "SENT",
		})
		as(sup)
		expect(
			await run(doc.id, {
				intent: "save_prefield",
				claroSupervisorId: claro.id,
				ordenNumber: "CHANGED",
			}),
		).toEqual({ errorKey: "packet.errors.prefield_locked" })
		const after = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(after.ordenNumber).toBe("SENT")
		expect(
			await db.auditTrail.count({
				where: { docId: doc.id, action: "PREFIELD_EDITED" },
			}),
		).toBe(0)
	})

	it("an out-of-scope supervisor is refused and nothing is written", async () => {
		const claro = await seedClaro({ requiresPrefield: true })
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		as(otherSup)
		const res = await run(doc.id, {
			intent: "save_prefield",
			claroSupervisorId: claro.id,
			ordenNumber: "HIJACK",
		})
		expect(res).toBeInstanceOf(Response)
		expect((res as Response).headers.get("Location")).toBe("/dashboard")
		const after = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(after.ordenNumber).toBeNull()
	})

	it("Admin may fill it too", async () => {
		const claro = await seedClaro({ requiresPrefield: true })
		const doc = await seedDoc({ claroSupervisorId: claro.id })
		as(admin)
		await run(doc.id, {
			intent: "save_prefield",
			claroSupervisorId: claro.id,
			titulo: "Admin title",
		})
		const after = await db.jafInvoice.findUniqueOrThrow({
			where: { id: doc.id },
		})
		expect(after.titulo).toBe("Admin title")
	})
})
