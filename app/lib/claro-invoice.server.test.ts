import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { extractText } from "unpdf"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	ClaroInvoiceError,
	claroInvoiceCounts,
	makeInvoice,
	makeInvoices,
	markLoaded,
	zipInvoices,
} from "~/lib/claro-invoice.server"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const t = makeTracker()
let dir: string
const prev = process.env.UPLOAD_DIR
beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "claro-inv-"))
	process.env.UPLOAD_DIR = dir
})
afterAll(async () => {
	await t.cleanup()
	process.env.UPLOAD_DIR = prev
	await fs.rm(dir, { recursive: true, force: true })
})

async function confirmedPo(
	userId: string,
	over: Partial<{
		subtotal: number
		ivu4: number
		ivu115: number
		total: number
		termsDays: number
	}> = {},
) {
	const doc = t.track("jafInvoice", await seedFinanceableInvoice())
	const po = await db.claroPo.create({
		data: {
			poNumber: String(4500000000 + Math.floor(Math.random() * 99999999)),
			poDate: new Date("2026-09-04T12:00:00Z"),
			termsDays: over.termsDays ?? 60,
			filePath: "x",
			fileName: "x.pdf",
			fileHash: runToken("h"),
			status: "CONFIRMED",
			docId: doc.id,
			subtotal: over.subtotal ?? 816.89,
			ivu4: over.ivu4 ?? 8.97,
			ivu115: over.ivu115 ?? 68.17,
			total: over.total ?? 894.03,
			confirmedAt: new Date(),
			confirmedById: userId,
			uploadedById: userId,
		},
	})
	t.track("claroPo", po)
	return po
}

describe("Claro invoices", () => {
	it("makes an invoice that matches the sample field for field", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const po = await confirmedPo(u.id)
		const made = await makeInvoice({
			poId: po.id,
			workMonth: "2026-05",
			madeById: u.id,
		})
		const inv = await db.claroInvoice.findUniqueOrThrow({
			where: { id: made.id },
		})
		expect(Number(inv.total)).toBe(894.03)
		const bytes = new Uint8Array(await fs.readFile(inv.filePath))
		const { text } = await extractText(bytes, { mergePages: true })
		for (const piece of [
			`M19-${made.seq}`,
			"PWOR",
			"MANT-JAF-MAY-2026",
			"05/01/2026",
			"05/31/2026",
			"Mantenimiento Planta Externa",
			po.poNumber as string,
			"$816.89",
			"$68.17",
			"$8.97",
			"$894.03",
		])
			expect(text).toContain(piece)
		const trail = await db.auditTrail.findFirst({
			where: { docId: po.docId as string, action: "CLARO_INVOICE_MADE" },
		})
		expect((trail?.diffJson as { source: string }).source).toBe("STAMPED")
	})

	it("numbers never repeat and never skip, even when made at the same time", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const pos = await Promise.all([1, 2, 3, 4].map(() => confirmedPo(u.id)))
		const made = await Promise.all(
			pos.map((p) =>
				makeInvoice({ poId: p.id, workMonth: "2026-05", madeById: u.id }),
			),
		)
		const seqs = made.map((m) => m.seq).sort((a, b) => a - b)
		expect(new Set(seqs).size).toBe(4)
		expect(seqs[3] - seqs[0]).toBe(3)
	})

	it("refuses a second invoice for the same PO, and a PO that is not confirmed", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const po = await confirmedPo(u.id)
		await makeInvoice({ poId: po.id, workMonth: "2026-05", madeById: u.id })
		await expect(
			makeInvoice({ poId: po.id, workMonth: "2026-05", madeById: u.id }),
		).rejects.toMatchObject({ code: "already_made" })
		const draft = await confirmedPo(u.id)
		await db.claroPo.update({
			where: { id: draft.id },
			data: { status: "READY" },
		})
		await expect(
			makeInvoice({ poId: draft.id, workMonth: "2026-05", madeById: u.id }),
		).rejects.toBeInstanceOf(ClaroInvoiceError)
	})

	it("refuses when the PO's own amounts do not add up to its total", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const po = await confirmedPo(u.id, { total: 900 })
		await expect(
			makeInvoice({ poId: po.id, workMonth: "2026-05", madeById: u.id }),
		).rejects.toMatchObject({ code: "total_mismatch" })
	})

	it("make-many counts the ones that could not be made", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const good = await confirmedPo(u.id)
		const bad = await confirmedPo(u.id, { total: 1 })
		const r = await makeInvoices(
			[
				{ poId: good.id, workMonth: "2026-05" },
				{ poId: bad.id, workMonth: "2026-05" },
			],
			u.id,
		)
		expect(r).toEqual({ made: 1, failed: 1 })
	})

	it("mark loaded stamps the date and sets due = loaded + PO terms, once", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const po = await confirmedPo(u.id, { termsDays: 60 })
		const made = await makeInvoice({
			poId: po.id,
			workMonth: "2026-05",
			madeById: u.id,
		})
		const before = await claroInvoiceCounts()
		const loadedAt = new Date("2026-09-23T15:00:00Z")
		expect(await markLoaded([made.id], u.id, loadedAt)).toEqual({ marked: 1 })
		const inv = await db.claroInvoice.findUniqueOrThrow({
			where: { id: made.id },
		})
		expect(inv.dueDate?.toISOString().slice(0, 10)).toBe("2026-11-22")
		expect(inv.loadedById).toBe(u.id)
		expect((await claroInvoiceCounts()).notLoaded).toBe(before.notLoaded - 1)
		// Loading again changes nothing.
		expect(await markLoaded([made.id], u.id, new Date())).toEqual({ marked: 0 })
		expect(
			(await db.claroInvoice.findUniqueOrThrow({ where: { id: made.id } }))
				.loadedAt,
		).toEqual(loadedAt)
	})

	it("zips the selected invoices' PDFs", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const po = await confirmedPo(u.id)
		const made = await makeInvoice({
			poId: po.id,
			workMonth: "2026-05",
			madeById: u.id,
		})
		const zip = await zipInvoices([made.id])
		expect(zip.subarray(0, 2).toString()).toBe("PK")
		expect(zip.toString("latin1")).toContain(`M19-${made.seq}.pdf`)
	})
})
