import fs from "node:fs/promises"
import path from "node:path"
import ExcelJS from "exceljs"
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	seedBrigade,
	seedFinanceableInvoice,
	seedServiceCode,
	seedUser,
} from "~/test/helpers"

// Capacity 3 instead of 100 so "the last packet closes the batch" is cheap.
vi.mock("~/lib/finance-home", () => ({
	PBCC_BATCH_CAPACITY: 3,
	NEXT_UP_LIMIT: 5,
}))
// The Aviso file here is just its number as text; the real reader parses PDFs.
vi.mock("~/lib/aviso-pdf.server", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/lib/aviso-pdf.server")>()),
	readAvisoNumber: async (bytes: Uint8Array) =>
		new TextDecoder().decode(bytes).replace(/\D/g, ""),
}))

import {
	addToOpenBatch,
	BatchError,
	bankDateLabel,
	checkBatch,
	closeOpenBatch,
	getOpenBatch,
	markBatchSent,
	takeOutRow,
} from "./pbcc-batch.server"
import { planPackage } from "./pbcc-package.server"

const t = makeTracker()
const docIds: string[] = []
const userIds: string[] = []

const uploadDir = () => process.env.UPLOAD_DIR || "/tmp/jaf/uploads"
const exists = (p: string) =>
	fs.access(p).then(
		() => true,
		() => false,
	)

/** Open batches left by an earlier run are not part of this one. */
async function clearOpenBatches() {
	const open = await db.bankSchedule.findMany({
		where: { closedAt: null },
		select: { id: true },
	})
	await db.jafInvoice.updateMany({
		where: { bankScheduleId: { in: open.map((o) => o.id) } },
		data: { bankScheduleId: null },
	})
	await db.bankSchedule.deleteMany({
		where: { id: { in: open.map((o) => o.id) } },
	})
}

/** Each test starts and ends with none of this file's packets or batches. */
async function clearMine() {
	await db.auditTrail.deleteMany({ where: { docId: { in: docIds } } })
	await db.jafInvoice.updateMany({
		where: { id: { in: docIds } },
		data: { bankScheduleId: null },
	})
	await db.bankSchedule.deleteMany({
		where: { generatedById: { in: userIds } },
	})
	await db.jafInvoice.deleteMany({ where: { id: { in: docIds } } })
	docIds.length = 0
}

beforeEach(clearOpenBatches)
afterEach(clearMine)
afterAll(async () => {
	await clearMine()
	await t.cleanup()
})

let finance: { id: string }
async function user() {
	if (!finance) {
		finance = await seedUser({ role: "FINANCE" })
		userIds.push(finance.id)
		t.track("user", finance)
	}
	return finance
}

/** An accepted packet: verified, unsent, with its Aviso file and a brigade area. */
async function accepted(
	opts: { subtotal?: number; area?: string | null; aviso?: string } = {},
) {
	const sup = t.track("user", await seedUser({ role: "SUPERVISOR" }))
	const brigade = t.track("brigade", await seedBrigade({ area: "NORTE" }))
	if (opts.area === null)
		await db.brigade.update({ where: { id: brigade.id }, data: { area: null } })
	const sc = t.track(
		"serviceCode",
		await seedServiceCode(`PB-${Math.random().toString(36).slice(2, 10)}`, {
			unitPrice: 100,
		}),
	)
	const subtotal = opts.subtotal ?? 100
	const aviso = opts.aviso ?? `9${Math.floor(Math.random() * 1e9)}`
	const doc = t.track(
		"jafInvoice",
		await seedFinanceableInvoice({
			supervisorId: sup.id,
			pbccRequestSentAt: null,
			avisoNumber: aviso,
			jafInvoiceLines: [
				{
					serviceCodeId: sc.id,
					claroCode: sc.claroCode,
					name: "Line",
					unit: "EA",
					qty: 1,
					unitPrice: subtotal,
					lineAmount: subtotal,
				},
			],
		}),
	)
	docIds.push(doc.id)
	const avisoFile = path.join(uploadDir(), "aviso-docs", `${doc.id}-aviso.pdf`)
	await fs.mkdir(path.dirname(avisoFile), { recursive: true })
	await fs.writeFile(avisoFile, aviso)
	await db.jafInvoice.update({
		where: { id: doc.id },
		data: {
			brigadeId: brigade.id,
			financeVerifiedAt: new Date(Date.now() - Math.random() * 1000),
			jafInvoiceLineTotal: subtotal,
			avisoDocPath: avisoFile,
			jobAddressActual: "Calle Luna 55, Mayagüez PR 00680",
		},
	})
	return { id: doc.id, aviso }
}

const rowsOf = (batchId: string) =>
	db.jafInvoice.findMany({
		where: { bankScheduleId: batchId },
		select: { id: true },
	})

describe("bankDateLabel", () => {
	it("is MM/DD/YY on the Puerto Rico calendar day", () => {
		expect(bankDateLabel(new Date("2026-08-06T02:00:00Z"))).toBe("08/05/26")
		expect(bankDateLabel(new Date("2026-08-06T04:00:00Z"))).toBe("08/06/26")
	})
})

describe("accepting fills the open batch", { timeout: 60_000 }, () => {
	it("opens one batch, adds the packet as a row, makes its invoice PDF and keeps the total", async () => {
		const u = await user()
		const a = await accepted({ subtotal: 100 })
		const b = await accepted({ subtotal: 50.5 })
		const first = await addToOpenBatch({ docId: a.id, userId: u.id })
		const second = await addToOpenBatch({ docId: b.id, userId: u.id })
		expect(second.batchId).toBe(first.batchId)
		expect(await db.bankSchedule.count({ where: { closedAt: null } })).toBe(1)

		const batch = await db.bankSchedule.findUniqueOrThrow({
			where: { id: first.batchId },
		})
		expect(batch.closedAt).toBeNull()
		expect(Number(batch.total)).toBe(150.5)
		// 80% advance, figured on the subtotal.
		expect(Number(batch.advanceAmount)).toBe(120.4)
		for (const id of [a.id, b.id]) {
			const doc = await db.jafInvoice.findUniqueOrThrow({ where: { id } })
			expect(doc.bankScheduleId).toBe(batch.id)
			expect(await exists(doc.bankInvoicePdfPath as string)).toBe(true)
		}
	})

	it("is safe to call again for a packet that is already in a batch", async () => {
		const u = await user()
		const a = await accepted()
		const one = await addToOpenBatch({ docId: a.id, userId: u.id })
		const two = await addToOpenBatch({ docId: a.id, userId: u.id })
		expect(two.batchId).toBe(one.batchId)
		expect(await rowsOf(one.batchId)).toHaveLength(1)
	})

	it("closes the batch on its last packet and opens the next by itself", async () => {
		const u = await user()
		const { _max } = await db.bankSchedule.aggregate({ _max: { number: true } })
		// Accepted one at a time, as Lissette does.
		let last: Awaited<ReturnType<typeof addToOpenBatch>> | undefined
		const earlier: Awaited<ReturnType<typeof addToOpenBatch>>[] = []
		for (let i = 0; i < 3; i++) {
			if (last) earlier.push(last)
			const d = await accepted()
			last = await addToOpenBatch({ docId: d.id, userId: u.id })
		}
		expect(earlier.every((e) => e.closedBatchIds.length === 0)).toBe(true)
		expect(last?.closedBatchIds).toEqual([last?.batchId])

		const closed = await db.bankSchedule.findUniqueOrThrow({
			where: { id: last?.batchId },
		})
		expect(closed.closedAt).not.toBeNull()
		// Closing builds the Excel.
		expect(await exists(closed.xlsxPath as string)).toBe(true)
		const open = await db.bankSchedule.findMany({ where: { closedAt: null } })
		expect(open).toHaveLength(1)
		expect(open[0].id).not.toBe(closed.id)
		expect(open[0].number).toBeNull()
		// Numbered at close, one after the highest: no gaps.
		expect(closed.number).toBe((_max.number ?? 0) + 1)
		// A fourth packet goes to the new batch.
		const d4 = await accepted()
		const fourth = await addToOpenBatch({ docId: d4.id, userId: u.id })
		expect(fourth.batchId).toBe(open[0].id)
	})

	it("adopts packets accepted before batches existed into a new batch", async () => {
		const u = await user()
		const waiting = [await accepted(), await accepted()]
		const batch = await getOpenBatch(u.id)
		expect((await rowsOf(batch.id)).map((r) => r.id).sort()).toEqual(
			waiting.map((w) => w.id).sort(),
		)
	})
})

describe("taking a row out", { timeout: 60_000 }, () => {
	it("needs a reason, leaves the batch, is audited, and lands in the next batch", async () => {
		const u = await user()
		const a = await accepted({ subtotal: 100 })
		const b = await accepted({ subtotal: 40 })
		const { batchId } = await addToOpenBatch({ docId: a.id, userId: u.id })
		await addToOpenBatch({ docId: b.id, userId: u.id })

		await expect(
			takeOutRow({ docId: b.id, reason: "  ", userId: u.id }),
		).rejects.toMatchObject({ code: "reason_required" })

		await takeOutRow({ docId: b.id, reason: "wrong Aviso", userId: u.id })
		const out = await db.jafInvoice.findUniqueOrThrow({ where: { id: b.id } })
		expect(out.bankScheduleId).toBeNull()
		// Not deleted, and still accepted.
		expect(out.financeVerifiedAt).not.toBeNull()
		expect(
			Number(
				(await db.bankSchedule.findUniqueOrThrow({ where: { id: batchId } }))
					.total,
			),
		).toBe(100)
		const audit = await db.auditTrail.findFirst({
			where: { docId: b.id, action: "PBCC_ROW_TAKEN_OUT" },
		})
		expect(audit?.diffJson).toMatchObject({ reason: "wrong Aviso" })

		await closeOpenBatch({ batchId, userId: u.id })
		const next = await db.bankSchedule.findFirstOrThrow({
			where: { closedAt: null },
		})
		expect((await rowsOf(next.id)).map((r) => r.id)).toEqual([b.id])
	})

	it("refuses a closed or sent batch, and a packet that is in no batch", async () => {
		const u = await user()
		const a = await accepted()
		const { batchId } = await addToOpenBatch({ docId: a.id, userId: u.id })
		await closeOpenBatch({ batchId, userId: u.id })
		await expect(
			takeOutRow({ docId: a.id, reason: "x", userId: u.id }),
		).rejects.toMatchObject({ code: "not_open" })
		const loose = await accepted()
		await expect(
			takeOutRow({ docId: loose.id, reason: "x", userId: u.id }),
		).rejects.toMatchObject({ code: "not_in_batch" })
	})
})

describe("closing a batch", { timeout: 60_000 }, () => {
	it("refuses an empty batch and a row with no area, and writes the Excel on close", async () => {
		const u = await user()
		const empty = await getOpenBatch(u.id)
		await expect(
			closeOpenBatch({ batchId: empty.id, userId: u.id }),
		).rejects.toMatchObject({ code: "empty" })

		const noArea = await accepted({ area: null })
		const { batchId } = await addToOpenBatch({ docId: noArea.id, userId: u.id })
		await expect(
			closeOpenBatch({ batchId, userId: u.id }),
		).rejects.toMatchObject({ code: "no_area" })
		expect(
			(await db.bankSchedule.findUniqueOrThrow({ where: { id: batchId } }))
				.closedAt,
		).toBeNull()

		await takeOutRow({ docId: noArea.id, reason: "no area", userId: u.id })
		const good = await accepted({ subtotal: 200 })
		await addToOpenBatch({ docId: good.id, userId: u.id })
		await closeOpenBatch({ batchId, userId: u.id })
		const closed = await db.bankSchedule.findUniqueOrThrow({
			where: { id: batchId },
		})
		const wb = new ExcelJS.Workbook()
		await wb.xlsx.readFile(closed.xlsxPath as string)
		const text = JSON.stringify(wb.worksheets[0].getSheetValues())
		expect(text).toContain(good.aviso)
	})
})

describe("the batch check", { timeout: 60_000 }, () => {
	async function closedBatch(n = 2) {
		const u = await user()
		const docs = []
		for (let i = 0; i < n; i++) docs.push(await accepted({ subtotal: 100 + i }))
		let batchId = ""
		for (const d of docs)
			batchId = (await addToOpenBatch({ docId: d.id, userId: u.id })).batchId
		await closeOpenBatch({ batchId, userId: u.id })
		return { batchId, docs, u }
	}

	it("is green for a consistent batch", async () => {
		const { batchId } = await closedBatch(2)
		expect(await checkBatch(batchId)).toMatchObject({
			rows: 2,
			avisoPdfs: 2,
			invoicePdfs: 2,
			avisoMismatches: [],
			totalMatches: true,
			duplicates: [],
			noArea: [],
			excel: true,
			passed: true,
		})
	})

	it("flags a missing invoice PDF, an Aviso file with another number, and a total that drifted", async () => {
		const { batchId, docs } = await closedBatch(2)
		const [a, b] = docs
		const docA = await db.jafInvoice.findUniqueOrThrow({ where: { id: a.id } })
		await fs.unlink(docA.bankInvoicePdfPath as string)
		const docB = await db.jafInvoice.findUniqueOrThrow({ where: { id: b.id } })
		await fs.writeFile(docB.avisoDocPath as string, "12345678")
		await db.bankSchedule.update({
			where: { id: batchId },
			data: { total: 1 },
		})
		const check = await checkBatch(batchId)
		expect(check.invoicePdfs).toBe(1)
		expect(check.avisoMismatches).toEqual([b.aviso])
		expect(check.totalMatches).toBe(false)
		expect(check.passed).toBe(false)
	})

	it("flags an Aviso that is already on a row of another batch", async () => {
		const { batchId, docs } = await closedBatch(1)
		const dup = await accepted({ aviso: docs[0].aviso })
		const u = await user()
		await addToOpenBatch({ docId: dup.id, userId: u.id })
		expect((await checkBatch(batchId)).duplicates).toEqual([docs[0].aviso])
	})
})

describe("marking a batch sent", { timeout: 60_000 }, () => {
	it("needs the batch closed and green, then stamps Sold to PBCC and locks it", async () => {
		const u = await user()
		const a = await accepted()
		const { batchId } = await addToOpenBatch({ docId: a.id, userId: u.id })
		await expect(
			markBatchSent({ batchId, sentById: u.id }),
		).rejects.toMatchObject({ code: "not_closed" })

		await closeOpenBatch({ batchId, userId: u.id })
		const doc = await db.jafInvoice.findUniqueOrThrow({ where: { id: a.id } })
		await fs.unlink(doc.bankInvoicePdfPath as string)
		await expect(
			markBatchSent({ batchId, sentById: u.id }),
		).rejects.toMatchObject({ code: "check_failed" })
		expect(
			(await db.jafInvoice.findUniqueOrThrow({ where: { id: a.id } }))
				.pbccRequestSentAt,
		).toBeNull()

		// Re-making the invoice (as every later step does) turns the check green.
		await db.jafInvoice.update({
			where: { id: a.id },
			data: { bankInvoicePdfPath: null },
		})
		const { finalizeBatch } = await import("./pbcc-batch.server")
		await finalizeBatch(batchId)
		expect(await markBatchSent({ batchId, sentById: u.id })).toEqual({
			alreadySent: false,
		})
		const sold = await db.jafInvoice.findUniqueOrThrow({ where: { id: a.id } })
		expect(sold.pbccRequestSentAt).not.toBeNull()
		expect(
			(await db.bankSchedule.findUniqueOrThrow({ where: { id: batchId } }))
				.sentAt,
		).not.toBeNull()
		// Second click is a no-op, and a sent batch cannot change.
		expect(await markBatchSent({ batchId, sentById: u.id })).toEqual({
			alreadySent: true,
		})
		await expect(
			takeOutRow({ docId: a.id, reason: "x", userId: u.id }),
		).rejects.toBeInstanceOf(BatchError)
	})
})

describe("a packet that falls out after it was batched", {
	timeout: 60_000,
}, () => {
	it("blocks Mark sent and stamps nobody", async () => {
		const u = await user()
		const a = await accepted()
		const b = await accepted()
		let batchId = ""
		for (const d of [a, b])
			batchId = (await addToOpenBatch({ docId: d.id, userId: u.id })).batchId
		await closeOpenBatch({ batchId, userId: u.id })
		// Sent back to the supervisor after it was batched.
		await db.jafInvoice.update({
			where: { id: b.id },
			data: { financeVerifiedAt: null },
		})
		await expect(
			markBatchSent({ batchId, sentById: u.id }),
		).rejects.toMatchObject({ code: "not_eligible" })
		for (const id of [a.id, b.id])
			expect(
				(await db.jafInvoice.findUniqueOrThrow({ where: { id } }))
					.pbccRequestSentAt,
			).toBeNull()
		expect(
			(await db.bankSchedule.findUniqueOrThrow({ where: { id: batchId } }))
				.sentAt,
		).toBeNull()
	})
})

describe("the package", { timeout: 60_000 }, () => {
	it("names files by row, puts the Excel in part 1 and splits to stay under the limit", async () => {
		const u = await user()
		const docs = [await accepted(), await accepted(), await accepted()]
		let batchId = ""
		for (const d of docs)
			batchId = (await addToOpenBatch({ docId: d.id, userId: u.id })).batchId
		// Three packets fill the batch (capacity 3), which closed itself.
		const whole = await planPackage(batchId)
		expect(whole).toHaveLength(1)
		expect(whole[0].files[0].name).toMatch(/^PBCC_Batch_\d+\.xlsx$/)
		expect(whole[0].files.map((f) => f.name.slice(0, 3))).toEqual(
			expect.arrayContaining(["001", "002", "003"]),
		)
		expect(whole[0].files.some((f) => /^001_Aviso_/.test(f.name))).toBe(true)
		expect(whole[0].files.some((f) => /^001_Inv_.*-/.test(f.name))).toBe(true)

		// A limit that fits only the Excel and one row at a time.
		const rowBytes = whole[0].files
			.filter((f) => f.name.startsWith("001"))
			.reduce((s, f) => s + f.bytes + 1024, 0)
		const excelBytes = whole[0].files[0].bytes + 1024
		const parts = await planPackage(batchId, excelBytes + rowBytes + 10)
		expect(parts.length).toBeGreaterThan(1)
		expect(parts[0].hasExcel).toBe(true)
		expect(parts.slice(1).every((p) => !p.hasExcel)).toBe(true)
		expect(parts[0].subject).toMatch(
			new RegExp(`JAF — PBCC Batch #\\d+ — Part 1 of ${parts.length}`),
		)
		// Every row is in exactly one part, in order, and no part splits a row.
		const rowsSeen = parts.flatMap((p) => [
			...new Set(
				p.files
					.filter((f) => /^\d{3}_/.test(f.name))
					.map((f) => f.name.slice(0, 3)),
			),
		])
		expect(rowsSeen).toEqual(["001", "002", "003"])
	})
})
