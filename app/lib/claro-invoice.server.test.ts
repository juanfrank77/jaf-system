import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { extractText } from "unpdf"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
	addOldInvoice,
	ClaroInvoiceError,
	claroInvoiceCounts,
	generateFromPo,
	invoiceFile,
	listInvoices,
	makeInvoice,
	makeInvoices,
	markLoaded,
	zipInvoices,
} from "~/lib/claro-invoice.server"
import { db } from "~/lib/db.server"
import { fixPo } from "~/lib/po-inbox.server"
import {
	makeTracker,
	runToken,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
const mocks = vi.hoisted(() => ({ signature: vi.fn() }))
vi.mock("~/lib/system-settings.server", async (original) => ({
	...(await original<typeof import("~/lib/system-settings.server")>()),
	getInvoiceSignature: mocks.signature,
}))

const t = makeTracker()
let dir: string
const prev = process.env.UPLOAD_DIR
beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "claro-inv-"))
	process.env.UPLOAD_DIR = dir
	mocks.signature.mockResolvedValue(PNG)
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

/** A read PO waiting on Review: one 100.00 line at 11.5%, billed 500 on its Aviso. */
async function reviewPo(
	userId: string,
	over: Partial<{
		statedPages: number
		termsDays: number | null
		amount: number
		total: number
	}> = {},
) {
	const doc = t.track(
		"jafInvoice",
		await seedFinanceableInvoice({
			jafInvoiceLines: [
				{
					serviceCodeId: "sc",
					claroCode: "c",
					name: "n",
					unit: "u",
					qty: 1,
					unitPrice: 500,
					lineAmount: 500,
				},
			],
		}),
	)
	const amount = over.amount ?? 100
	const ivu = Math.round(amount * 0.115 * 100) / 100
	const po = await db.claroPo.create({
		data: {
			poNumber: String(4500000000 + Math.floor(Math.random() * 99999999)),
			poDate: new Date("2026-09-04T12:00:00Z"),
			termsDays: over.termsDays === undefined ? 60 : over.termsDays,
			statedPages: over.statedPages ?? 1,
			filePages: 1,
			filePath: "x",
			fileName: "x.pdf",
			fileHash: runToken("h"),
			status: "NEEDS_LOOK",
			docId: doc.id,
			lines: [{ item: "10", description: "x", amount, ivuRate: 0.115, ivu }],
			subtotal: amount,
			ivu4: 0,
			ivu115: ivu,
			total: over.total ?? amount + ivu,
			uploadedById: userId,
		},
	})
	t.track("claroPo", po)
	return po
}

describe("Claro invoices", () => {
	it("generateFromPo on missing pages says not_confirmable even when the amounts are off", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const po = await reviewPo(u.id, { statedPages: 3, total: 999 })
		await expect(
			generateFromPo({
				poId: po.id,
				userId: u.id,
				workMonth: "2026-05",
				overrides: [{ check: "totals", reason: "x" }],
			}),
		).rejects.toMatchObject({ name: "PoError", code: "not_confirmable" })
	})

	it("a line edited off the printed total is red, and generates once a reason is given", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const po = await reviewPo(u.id)
		await fixPo(po.id, u.id, {
			lines: [{ item: "10", description: "x", amount: 120, ivuRate: 0.115 }],
		})
		const row = await db.claroPo.findUniqueOrThrow({ where: { id: po.id } })
		const codes = (row.checks as { code: string }[]).map((c) => c.code)
		expect(codes).toEqual(expect.arrayContaining(["lines_sum", "totals"]))
		const args = { poId: po.id, userId: u.id, workMonth: "2026-05" }
		await expect(
			generateFromPo({ ...args, overrides: [] }),
		).rejects.toMatchObject({ code: "not_confirmable" })
		const made = await generateFromPo({
			...args,
			overrides: [
				{ check: "lines_sum", reason: "Claro raised the line" },
				{ check: "totals", reason: "Claro raised the line" },
			],
		})
		const inv = await db.claroInvoice.findUniqueOrThrow({
			where: { id: made.invoiceId },
		})
		expect(Number(inv.total)).toBe(133.8)
	})

	it("generateFromPo clicked twice at once makes one invoice, one PoLink and one confirm", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const po = await reviewPo(u.id)
		const args = {
			poId: po.id,
			userId: u.id,
			workMonth: "2026-05",
			overrides: [],
		}
		const results = await Promise.allSettled([
			generateFromPo(args),
			generateFromPo(args),
		])
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
		const lost = results.find((r) => r.status === "rejected")
		expect((lost as PromiseRejectedResult).reason).toMatchObject({
			code: "already_made",
		})
		expect(await db.claroInvoice.count({ where: { claroPoId: po.id } })).toBe(1)
		expect(
			await db.poLink.count({ where: { docId: po.docId as string } }),
		).toBe(1)
		expect(
			await db.auditTrail.count({
				where: { docId: po.docId as string, action: "PO_CONFIRMED" },
			}),
		).toBe(1)
		expect(
			(await db.claroPo.findUniqueOrThrow({ where: { id: po.id } })).status,
		).toBe("CONFIRMED")
	})

	it("generateFromPo refuses missing pages", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const po = await reviewPo(u.id, { statedPages: 3 })
		await expect(
			generateFromPo({
				poId: po.id,
				userId: u.id,
				workMonth: "2026-05",
				overrides: [{ check: "pages_missing", reason: "it is all there" }],
			}),
		).rejects.toMatchObject({ name: "PoError", code: "not_confirmable" })
		expect(await db.claroInvoice.count({ where: { claroPoId: po.id } })).toBe(0)
		expect(
			(await db.claroPo.findUniqueOrThrow({ where: { id: po.id } })).status,
		).toBe("BLOCKED")
	})

	it("refuses a red check without a reason", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const po = await reviewPo(u.id, { termsDays: null })
		for (const overrides of [
			[],
			[{ check: "terms_missing" as const, reason: "  " }],
		])
			await expect(
				generateFromPo({
					poId: po.id,
					userId: u.id,
					workMonth: "2026-05",
					overrides,
				}),
			).rejects.toMatchObject({ name: "PoError", code: "not_confirmable" })
		const row = await db.claroPo.findUniqueOrThrow({ where: { id: po.id } })
		expect(row.status).toBe("NEEDS_LOOK")
		expect(row.overrides).toBeNull()
		expect(await db.claroInvoice.count({ where: { claroPoId: po.id } })).toBe(0)
	})

	it("generateFromPo with a reason makes one invoice and one audit row per override", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		// 600 against 500 billed, and no terms: two red checks.
		const po = await reviewPo(u.id, { termsDays: null, amount: 600 })
		const made = await generateFromPo({
			poId: po.id,
			userId: u.id,
			workMonth: "2026-05",
			overrides: [
				{ check: "over_billed", reason: "Claro added a line" },
				{ check: "terms_missing", reason: "60 days per contract" },
			],
		})
		expect(await db.claroInvoice.count({ where: { claroPoId: po.id } })).toBe(1)
		const inv = await db.claroInvoice.findUniqueOrThrow({
			where: { id: made.invoiceId },
		})
		expect(inv.seq).toBe(made.seq)
		const row = await db.claroPo.findUniqueOrThrow({ where: { id: po.id } })
		expect(row.status).toBe("CONFIRMED")
		expect(row.overrides).toHaveLength(2)
		expect(row.overrides).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					check: "over_billed",
					reason: "Claro added a line",
					byId: u.id,
				}),
				expect.objectContaining({
					check: "terms_missing",
					reason: "60 days per contract",
					byId: u.id,
				}),
			]),
		)
		const trail = await db.auditTrail.findMany({
			where: { docId: po.docId as string, action: "PO_CHECK_OVERRIDDEN" },
		})
		expect(trail).toHaveLength(2)
		expect(trail.map((a) => a.diffJson)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					check: "over_billed",
					reason: "Claro added a line",
					byId: u.id,
					at: expect.any(String),
				}),
				expect.objectContaining({ check: "terms_missing", byId: u.id }),
			]),
		)
	})

	it("generateFromPo twice returns already_made and the next invoice number is seq+1, not seq+2", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const po = await reviewPo(u.id)
		const args = {
			poId: po.id,
			userId: u.id,
			workMonth: "2026-05",
			overrides: [],
		}
		const first = await generateFromPo(args)
		await expect(generateFromPo(args)).rejects.toMatchObject({
			name: "ClaroInvoiceError",
			code: "already_made",
		})
		const other = await reviewPo(u.id)
		const next = await generateFromPo({ ...args, poId: other.id })
		expect(next.seq).toBe(first.seq + 1)
	})

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
		const bytes = new Uint8Array(await fs.readFile(inv.filePath as string))
		const { text } = await extractText(bytes, { mergePages: true })
		for (const piece of [
			`M20-${String(made.seq).padStart(3, "0")}`,
			"PWOR",
			"MANT-JAF-MAY-2026",
			"05/01/2026",
			"05/31/2026",
			"Mantenimiento Planta Externa",
			po.poNumber as string,
			"$816.89",
			"$68.17",
			"$8.97",
			"894.03",
		])
			expect(text).toContain(piece)
		const trail = await db.auditTrail.findFirst({
			where: { docId: po.docId as string, action: "CLARO_INVOICE_MADE" },
		})
		expect(trail?.diffJson).toMatchObject({
			source: "STAMPED",
			signedBy: "Lissette Cintron",
		})
	})

	it("makes nothing unsigned: without a stored signature no number is taken", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const po = await confirmedPo(u.id)
		mocks.signature.mockResolvedValueOnce(null)
		await expect(
			makeInvoice({ poId: po.id, workMonth: "2026-05", madeById: u.id }),
		).rejects.toMatchObject({ code: "no_signature" })
		expect(await db.claroInvoice.count({ where: { claroPoId: po.id } })).toBe(0)
	})

	it("new numbers follow their own series, whatever the old M19 numbers are", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const high = 8_000_000 + Math.floor(Math.random() * 900_000)
		const old = await addOldInvoice({
			number: `M19-${high}`,
			total: 10,
			poNumber: null,
			loadedAt: null,
			userId: u.id,
		})
		const po = await confirmedPo(u.id)
		const made = await makeInvoice({
			poId: po.id,
			workMonth: "2026-05",
			madeById: u.id,
		})
		expect(made.seq).toBeLessThan(high)
		await db.claroInvoice.delete({ where: { id: old.id } })
	})

	it("an old M19 and a new M20 can share a number", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const po = await confirmedPo(u.id)
		const made = await makeInvoice({
			poId: po.id,
			workMonth: "2026-05",
			madeById: u.id,
		})
		const old = await addOldInvoice({
			number: `M19-${made.seq}`,
			total: 10,
			poNumber: null,
			loadedAt: null,
			userId: u.id,
		})
		expect(old.id).not.toBe(made.id)
		await db.claroInvoice.delete({ where: { id: old.id } })
	})

	it("adds an old M19 from a PO: it leaves To make, keeps the typed total and has no PDF", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const po = await confirmedPo(u.id, { termsDays: 30 })
		const seq = 8_100_000 + Math.floor(Math.random() * 900_000)
		const old = await addOldInvoice({
			number: `M19-${seq}`,
			total: 221.62,
			poNumber: po.poNumber,
			loadedAt: new Date("2026-09-01T12:00:00Z"),
			userId: u.id,
		})
		const inv = await db.claroInvoice.findUniqueOrThrow({
			where: { id: old.id },
		})
		expect(inv).toMatchObject({
			series: "M19",
			seq,
			claroPoId: po.id,
			docId: po.docId,
			filePath: null,
		})
		expect(Number(inv.total)).toBe(221.62)
		expect(inv.dueDate?.toISOString().slice(0, 10)).toBe("2026-10-01")
		expect(await invoiceFile(old.id)).toBeNull()
		const listed = (await listInvoices("in_ariba")).find((r) => r.id === old.id)
		expect(listed).toMatchObject({
			number: `M19-${seq}`,
			poNumber: po.poNumber,
			hasFile: false,
		})
		const trail = await db.auditTrail.findFirst({
			where: { docId: po.docId as string, action: "CLARO_INVOICE_ADDED_OLD" },
		})
		expect(trail?.diffJson).toMatchObject({
			source: "ENTERED",
			invoice: `M19-${seq}`,
		})
		// A second invoice for that PO cannot be made.
		await expect(
			makeInvoice({ poId: po.id, workMonth: "2026-05", madeById: u.id }),
		).rejects.toMatchObject({ code: "already_made" })
	})

	it("an old M19 needs no PO or Aviso when a payment is all that refers to it", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const seq = 8_200_000 + Math.floor(Math.random() * 900_000)
		const old = await addOldInvoice({
			number: `M19-${seq}`,
			total: 50,
			poNumber: null,
			loadedAt: null,
			userId: u.id,
		})
		const zip = await zipInvoices([old.id])
		expect(zip.toString("latin1")).not.toContain(`M19-${seq}.pdf`)
		const marked = await markLoaded(
			[old.id],
			u.id,
			new Date("2026-09-01T12:00:00Z"),
		)
		expect(marked).toEqual({ marked: 1 })
		await db.claroInvoice.delete({ where: { id: old.id } })
	})

	it("refuses an old number that is not M19, is taken, or names a PO it cannot use", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const add = (number: string, poNumber: string | null = null, total = 10) =>
			addOldInvoice({ number, total, poNumber, loadedAt: null, userId: u.id })
		await expect(add("M20-5")).rejects.toMatchObject({ code: "not_old_number" })
		await expect(add("3440")).rejects.toMatchObject({ code: "not_old_number" })
		const seq = 8_300_000 + Math.floor(Math.random() * 900_000)
		const old = await add(`M19-${seq}`)
		await expect(add(`M19-${seq}`)).rejects.toMatchObject({
			code: "number_taken",
		})
		await expect(add(`M19-${seq + 1}`, "0000000000")).rejects.toMatchObject({
			code: "po_not_available",
		})
		await expect(add(`M19-${seq + 1}`, null, 0)).rejects.toMatchObject({
			code: "bad_total",
		})
		await db.claroInvoice.delete({ where: { id: old.id } })
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

	it("two POs generated at the same time each get a PDF carrying their own number", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		// A few rounds: the clash needs both makes to pick the same number.
		for (let round = 0; round < 3; round++) {
			const pos = await Promise.all([
				reviewPo(u.id, { amount: 100 }),
				reviewPo(u.id, { amount: 200 }),
			])
			const made = await Promise.all(
				pos.map((p) =>
					generateFromPo({
						poId: p.id,
						userId: u.id,
						workMonth: "2026-05",
						overrides: [],
					}),
				),
			)
			const invs = await Promise.all(
				made.map((m) =>
					db.claroInvoice.findUniqueOrThrow({ where: { id: m.invoiceId } }),
				),
			)
			expect(invs[0].filePath).not.toBe(invs[1].filePath)
			for (const [i, inv] of invs.entries()) {
				const bytes = new Uint8Array(await fs.readFile(inv.filePath as string))
				const { text } = await extractText(bytes, { mergePages: true })
				expect(text).toContain(`M20-${String(inv.seq).padStart(3, "0")}`)
				expect(text).toContain(pos[i].poNumber as string)
			}
		}
	}, 60_000)

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
		expect(zip.toString("latin1")).toContain(
			`M20-${String(made.seq).padStart(3, "0")}.pdf`,
		)
	})
})
