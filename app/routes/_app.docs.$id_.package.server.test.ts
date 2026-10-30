import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { strFromU8, unzipSync } from "fflate"
import { PDFDocument } from "pdf-lib"
import { redirect } from "react-router"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// GET /docs/:id/package, "Download all (zip)", against the real DB and real
// files under UPLOAD_DIR.
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))

import { db } from "~/lib/db.server"
import { makePdf, makePng, pageMatrices } from "~/lib/package-pdf.test-helpers"
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

async function get(docId: string, query = ""): Promise<Response> {
	try {
		return (await loader({
			request: new Request(`http://localhost/docs/${docId}/package${query}`),
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
	it("with ?format=zip, zips the work order PDF, the Prefield PDF and the original photos and blueprints, as stored", async () => {
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
			data: {
				docId: doc.id,
				uploadedById: sup.id,
				localPath: photo,
				tag: "BEFORE",
			},
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
		const res = await get(doc.id, "?format=zip")
		expect(res.status).toBe(200)
		expect(res.headers.get("Content-Type")).toBe("application/zip")
		expect(res.headers.get("Content-Disposition")).toContain(
			`${doc.controlNumber}-package.zip`,
		)
		const entries = unzipSync(new Uint8Array(await res.arrayBuffer()))
		expect(Object.keys(entries).sort()).toEqual(
			[
				`Prefield ${doc.controlNumber}.pdf`,
				`JAF work order ${doc.controlNumber}.pdf`,
				"Photo 1 - before.jpg",
				"Blueprint 1.pdf",
			].sort(),
		)
		expect(strFromU8(entries["Blueprint 1.pdf"])).toBe("%PDF-plan")
		expect(Buffer.from(entries["Photo 1 - before.jpg"]).equals(jpg)).toBe(true)
	})

	it("by default returns one PDF: report, Prefield, then the photos in order, skipping a .heic", async () => {
		const doc = await seedDoc({ prefieldNeeded: true })
		const wo = await saveBuffer(
			"packets",
			`${doc.id}-work-order-1.pdf`,
			await makePdf([
				[200, 200],
				[200, 200],
			]),
		)
		const pf = await saveBuffer(
			"packets",
			`${doc.id}-prefield-1.pdf`,
			await makePdf([[320, 320]]),
		)
		const t0 = Date.now()
		for (const [i, [name, buf, tag]] of (
			[
				["tall.png", makePng(100, 400), "BEFORE"],
				["skip.heic", Buffer.from("x"), "DURING"],
				["wide.png", makePng(400, 100), "AFTER"],
			] as const
		).entries()) {
			const file = photoFile(doc.id, name)
			await mkdir(path.dirname(file), { recursive: true })
			await writeFile(file, buf)
			await db.photo.create({
				data: {
					docId: doc.id,
					uploadedById: sup.id,
					localPath: file,
					tag,
					takenAt: new Date(t0 + i * 1000),
				},
			})
		}
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: { jafInvoicePdfPath: wo, prefieldPdfPath: pf },
		})
		as(sup)
		vi.spyOn(console, "warn").mockImplementation(() => {})
		for (const q of ["", "?format=pdf"]) {
			const res = await get(doc.id, q)
			expect(res.status).toBe(200)
			expect(res.headers.get("Content-Type")).toBe("application/pdf")
			expect(res.headers.get("Content-Disposition")).toContain(
				`${doc.controlNumber}-package.pdf`,
			)
			const out = await PDFDocument.load(
				new Uint8Array(await res.arrayBuffer()),
			)
			const pages = out.getPages()
			// report x2, Prefield, tall, wide, and the "Not included" page
			expect(pages.map((p) => Math.round(p.getWidth()))).toEqual([
				200, 200, 320, 595, 595, 595,
			])
			expect(
				pageMatrices(pages[3])[2].filter((_n, i) => i === 0 || i === 3),
			).toEqual([100, 400])
			expect(
				pageMatrices(pages[4])[2].filter((_n, i) => i === 0 || i === 3),
			).toEqual([400, 100])
		}
	})

	it("is 400 for an unknown ?format", async () => {
		const doc = await seedDoc({
			jafInvoicePdfPath: "/x/packets/a-work-order-1.pdf",
		})
		as(sup)
		expect((await get(doc.id, "?format=docx")).status).toBe(400)
	})

	it("is 422, not a blank PDF, when none of the files can be read", async () => {
		const doc = await seedDoc()
		const wo = await saveBuffer(
			"packets",
			`${doc.id}-work-order-1.pdf`,
			Buffer.from("not a pdf at all"),
		)
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: { jafInvoicePdfPath: wo },
		})
		as(sup)
		vi.spyOn(console, "warn").mockImplementation(() => {})
		const res = await get(doc.id)
		expect(res.status).toBe(422)
		expect(res.headers.get("Content-Type")).not.toBe("application/pdf")
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
