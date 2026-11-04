import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { strFromU8, unzipSync } from "fflate"
import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { photoFile, saveBuffer } from "~/lib/uploads.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"

// GET /finance/verify/:id/packet.zip against the real DB and real files under
// UPLOAD_DIR.
vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))

import { requireRole } from "~/lib/permissions.server"
import { loader } from "./_app.finance.verify.$id.packet.zip"

const t = makeTracker()
const docIds: string[] = []
afterAll(async () => {
	await db.photo.deleteMany({ where: { docId: { in: docIds } } })
	await db.preCertSheet.deleteMany({ where: { docId: { in: docIds } } })
	await t.cleanup()
})
const seedDoc = async (
	overrides: Parameters<typeof seedFinanceableInvoice>[0],
) => {
	const doc = t.track("jafInvoice", await seedFinanceableInvoice(overrides))
	docIds.push(doc.id)
	return doc
}

async function get(id: string): Promise<Response> {
	return (await loader({
		request: new Request(`http://localhost/finance/verify/${id}/packet.zip`),
		params: { id },
	} as never)) as Response
}

describe("GET /finance/verify/:id/packet.zip", { timeout: 60_000 }, () => {
	it("zips the packet's four documents in review order, as stored", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		vi.mocked(requireRole).mockResolvedValue({ user: finance } as never)
		const doc = await seedDoc({ pbccRequestSentAt: null })
		const invoice = await saveBuffer(
			"packets",
			`${doc.id}-packet-1.pdf`,
			Buffer.from("%PDF-invoice"),
		)
		const aviso = await saveBuffer(
			"aviso-docs",
			`${doc.id}-aviso.pdf`,
			Buffer.from("%PDF-aviso"),
		)
		const precert = await saveBuffer(
			"precert",
			`${doc.id}-v1.pdf`,
			Buffer.from("%PDF-precert"),
		)
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: { jafInvoicePdfPath: invoice, avisoDocPath: aviso },
		})
		await db.preCertSheet.create({
			data: {
				docId: doc.id,
				version: 1,
				certifiedAddress: "x",
				title: "x",
				issuedOn: new Date(),
				lines: [],
				total: 0,
				issuedById: finance.id,
				sigSupervisorAt: new Date(),
				sigSubcontractorAt: new Date(),
				pdfPath: precert,
			},
		})
		const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7])
		for (const [name, tag, takenAt] of [
			["before.jpg", "BEFORE", "2026-10-01"],
			["after.jpg", "AFTER", "2026-10-02"],
		] as const) {
			const file = photoFile(doc.id, name)
			await mkdir(path.dirname(file), { recursive: true })
			await writeFile(file, jpg)
			await db.photo.create({
				data: {
					docId: doc.id,
					uploadedById: finance.id,
					localPath: file,
					tag,
					takenAt: new Date(takenAt),
				},
			})
		}

		const res = await get(doc.id)
		expect(res.status).toBe(200)
		expect(res.headers.get("Content-Type")).toBe("application/zip")
		expect(res.headers.get("Content-Disposition")).toContain(
			`${doc.controlNumber}-packet.zip`,
		)
		const entries = unzipSync(new Uint8Array(await res.arrayBuffer()))
		expect(Object.keys(entries).sort()).toEqual(
			[
				`1_JAF_invoice_${doc.id}-packet-1.pdf`,
				`2_Aviso_10353961_${doc.id}-aviso.pdf`,
				`3_Precert_${doc.id}-v1.pdf`,
				"4_Photo_01_before.jpg",
				"4_Photo_02_after.jpg",
			].sort(),
		)
		expect(strFromU8(entries[`2_Aviso_10353961_${doc.id}-aviso.pdf`])).toBe(
			"%PDF-aviso",
		)
		expect(Buffer.from(entries["4_Photo_01_before.jpg"]).equals(jpg)).toBe(true)
	})

	it("leaves out a document the release gate does not count, and 404s an unreleased packet", async () => {
		const finance = t.track("user", await seedUser({ role: "FINANCE" }))
		vi.mocked(requireRole).mockResolvedValue({ user: finance } as never)
		const unreleased = await seedDoc({ releasedToFinanceAt: null })
		expect((await get(unreleased.id)).status).toBe(404)
		// Released, but no packet file, no pre-cert and no photos: only the Aviso.
		const doc = await seedDoc({ pbccRequestSentAt: null })
		const aviso = await saveBuffer(
			"aviso-docs",
			`${doc.id}-aviso.pdf`,
			Buffer.from("%PDF-aviso"),
		)
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: { avisoDocPath: aviso },
		})
		const res = await get(doc.id)
		expect(res.status).toBe(200)
		const names = Object.keys(
			unzipSync(new Uint8Array(await res.arrayBuffer())),
		)
		expect(names).toEqual([`2_Aviso_10353961_${doc.id}-aviso.pdf`])
	})
})
