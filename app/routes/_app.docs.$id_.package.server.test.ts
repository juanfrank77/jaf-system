import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { strFromU8, unzipSync } from "fflate"
import { redirect } from "react-router"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// GET /docs/:id/package, "Download all (zip)", against the real DB and real
// files under UPLOAD_DIR.
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { photoFile, saveBuffer } from "~/lib/uploads.server"
import { loader } from "./_app.docs.$id_.package"

const HOOK_TIMEOUT = 60_000
const TAG = `pkz-${Date.now()}`
const userIds: string[] = []
const docIds: string[] = []

type Seeded = {
	id: string
	name: string
	role: "SUPERVISOR" | "ADMIN" | "FINANCE" | "COMPTROLLER"
}
let sup: Seeded
let otherSup: Seeded

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

async function seedDoc(extra: Record<string, unknown> = {}) {
	const d = await db.jafInvoice.create({
		data: {
			controlNumber: `${TAG}-${Math.random()}`,
			jobType: "Mantenimiento",
			jobAddressEstimated: "Calle 1",
			estimatedMaterials: [],
			supervisorId: sup.id,
			status: "SUPERVISOR_APPROVED",
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

async function get(docId: string): Promise<Response> {
	try {
		return (await loader({
			request: new Request(`http://localhost/docs/${docId}/package`),
			params: { id: docId },
		} as any)) as Response
	} catch (e) {
		if (e instanceof Response) return e
		throw e
	}
}

beforeAll(async () => {
	sup = await seedUser("SUPERVISOR")
	otherSup = await seedUser("SUPERVISOR")
}, HOOK_TIMEOUT)

afterAll(async () => {
	await db.photo.deleteMany({ where: { docId: { in: docIds } } })
	await db.jafInvoice.deleteMany({ where: { id: { in: docIds } } })
	await db.user.deleteMany({ where: { id: { in: userIds } } })
}, HOOK_TIMEOUT)

describe("GET /docs/:id/package", { timeout: HOOK_TIMEOUT }, () => {
	it("zips the work order PDF, the Prefield PDF and the original photos and blueprints, as stored", async () => {
		const doc = await seedDoc({ prefieldNeeded: true })
		const wo = await saveBuffer(
			"packets",
			`${doc.id}-work-order-1.pdf`,
			Buffer.from("%PDF-wo"),
		)
		const pf = await saveBuffer(
			"packets",
			`${doc.id}-prefield-1.pdf`,
			Buffer.from("%PDF-pf"),
		)
		const plans = path.join(
			process.env.UPLOAD_DIR as string,
			"blueprints",
			doc.id,
		)
		await mkdir(plans, { recursive: true })
		await writeFile(path.join(plans, "plano.pdf"), "%PDF-plan")
		const photo = photoFile(doc.id, "before.jpg")
		await mkdir(path.dirname(photo), { recursive: true })
		const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7])
		await writeFile(photo, jpg)
		await db.photo.create({
			data: { docId: doc.id, uploadedById: sup.id, localPath: photo },
		})
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: {
				jafInvoicePdfPath: wo,
				prefieldPdfPath: pf,
				blueprintPaths: [path.join(plans, "plano.pdf")],
			},
		})
		as(sup)
		const res = await get(doc.id)
		expect(res.status).toBe(200)
		expect(res.headers.get("Content-Type")).toBe("application/zip")
		expect(res.headers.get("Content-Disposition")).toContain(
			`${doc.controlNumber}-package.zip`,
		)
		const entries = unzipSync(new Uint8Array(await res.arrayBuffer()))
		expect(Object.keys(entries).sort()).toEqual(
			[
				`${doc.id}-prefield-1.pdf`,
				`${doc.id}-work-order-1.pdf`,
				"before.jpg",
				"plano.pdf",
			].sort(),
		)
		expect(strFromU8(entries["plano.pdf"])).toBe("%PDF-plan")
		expect(Buffer.from(entries["before.jpg"]).equals(jpg)).toBe(true)
	})

	it("is 404 when there is nothing in the package", async () => {
		const doc = await seedDoc()
		as(sup)
		expect((await get(doc.id)).status).toBe(404)
	})

	it("refuses a supervisor outside the job's scope", async () => {
		const doc = await seedDoc({
			jafInvoicePdfPath: "/x/packets/a-work-order-1.pdf",
		})
		as(otherSup)
		const res = await get(doc.id)
		expect(res.status).toBe(302)
		expect(res.headers.get("Location")).toBe("/dashboard")
	})

	it.each(["FINANCE", "COMPTROLLER"] as const)(
		"refuses %s (the package is the supervisor's)",
		async (role) => {
			const doc = await seedDoc({
				jafInvoicePdfPath: "/x/packets/a-work-order-1.pdf",
			})
			as(await seedUser(role))
			const res = await get(doc.id)
			expect(res.status).toBe(302)
			expect(res.headers.get("Location")).toBe("/dashboard")
		},
	)
})
