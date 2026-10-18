import { afterAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"

const TAG = `swf-${Date.now()}`
const userIds: string[] = []
const docIds: string[] = []
const supIds: string[] = []

async function seedUser() {
	const u = await db.user.create({
		data: {
			email: `${TAG}-${Math.random()}@x.test`,
			name: "SWF",
			role: "SUPERVISOR",
		},
	})
	userIds.push(u.id)
	return u
}
async function seedDoc(supervisorId: string, extra = {}) {
	const d = await db.jafInvoice.create({
		data: {
			controlNumber: `${TAG}-${Math.random()}`,
			jobType: "T",
			jobAddressEstimated: "A",
			estimatedMaterials: [],
			supervisorId,
			...extra,
		},
	})
	docIds.push(d.id)
	return d
}

afterAll(async () => {
	await db.photo.deleteMany({ where: { docId: { in: docIds } } })
	await db.packetSend.deleteMany({ where: { docId: { in: docIds } } })
	await db.jafInvoice.deleteMany({ where: { id: { in: docIds } } })
	await db.claroSupervisor.deleteMany({ where: { id: { in: supIds } } })
	await db.user.deleteMany({ where: { id: { in: userIds } } })
})

describe("supervisor workflow schema", () => {
	it("stores a ClaroSupervisor with email and flags", async () => {
		const s = await db.claroSupervisor.create({
			data: { name: `${TAG}-cs`, email: `${TAG}@claro.test` },
		})
		supIds.push(s.id)
		expect(s.active).toBe(true)
		expect(s.requiresPrefield).toBe(false)
		expect(s.requiresBlueprint).toBe(false)
		const u = await db.claroSupervisor.update({
			where: { id: s.id },
			data: { requiresPrefield: true, requiresBlueprint: true },
		})
		expect(u.requiresPrefield && u.requiresBlueprint).toBe(true)
	})

	it("logs two PacketSend rows for one doc ordered by sentAt", async () => {
		const user = await seedUser()
		const doc = await seedDoc(user.id)
		await db.packetSend.create({
			data: {
				docId: doc.id,
				sentById: user.id,
				recipientEmail: "a@x.test",
				outcome: "FAILED",
				error: "boom",
				sentAt: new Date("2026-01-01T00:00:00Z"),
			},
		})
		await db.packetSend.create({
			data: {
				docId: doc.id,
				sentById: user.id,
				recipientEmail: "a@x.test",
				outcome: "SENT",
				sentAt: new Date("2026-01-02T00:00:00Z"),
			},
		})
		const rows = await db.packetSend.findMany({
			where: { docId: doc.id },
			orderBy: { sentAt: "asc" },
		})
		expect(rows.map((r) => r.outcome)).toEqual(["FAILED", "SENT"])
	})

	it("accepts PhotoTag DURING", async () => {
		const user = await seedUser()
		const doc = await seedDoc(user.id)
		const p = await db.photo.create({
			data: {
				docId: doc.id,
				uploadedById: user.id,
				localPath: "x.jpg",
				tag: "DURING",
			},
		})
		expect(p.tag).toBe("DURING")
	})

	it("defaults blueprintPaths to []", async () => {
		const user = await seedUser()
		const doc = await seedDoc(user.id)
		expect(doc.blueprintPaths).toEqual([])
		expect(doc.fieldStartedAt).toBeNull()
		expect(doc.claroSupervisorId).toBeNull()
	})
})
