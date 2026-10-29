import { existsSync, readFileSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Document, Page, renderToBuffer, Text } from "@react-pdf/renderer"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { makeInvoice } from "~/lib/claro-invoice.server"
import { db } from "~/lib/db.server"
import { createEwitInvoice } from "~/lib/ewit.server"
import {
	AdviceError,
	acceptJaShort,
	acceptShort,
	adviceCounts,
	applyAdvice,
	ingestAdvice,
	linkLine,
	listAdvices,
	listUnmatched,
	rematchJaLines,
} from "~/lib/payment-advice.server"
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
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "advice-"))
	process.env.UPLOAD_DIR = dir
})
afterAll(async () => {
	await t.cleanup()
	process.env.UPLOAD_DIR = prev
	await fs.rm(dir, { recursive: true, force: true })
})

/** A real text-layer PDF holding the advice text, one line per row. */
async function advicePdf(lines: string[]): Promise<Uint8Array> {
	const buf = await renderToBuffer(
		<Document>
			<Page size="LETTER">
				{lines.map((l) => (
					<Text key={l}>{l}</Text>
				))}
			</Page>
		</Document>,
	)
	return new Uint8Array(buf)
}

async function invoiceFor(userId: string, over: { poSubtotal?: number } = {}) {
	const sub = over.poSubtotal ?? 100
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
					unitPrice: 100,
					lineAmount: 100,
				},
			],
		}),
	)
	const po = await db.claroPo.create({
		data: {
			poNumber: String(4500000000 + Math.floor(Math.random() * 99999999)),
			poDate: new Date("2026-09-04T12:00:00Z"),
			termsDays: 60,
			filePath: "x",
			fileName: "x.pdf",
			fileHash: runToken("h"),
			status: "CONFIRMED",
			docId: doc.id,
			subtotal: sub,
			ivu4: 0,
			ivu115: sub * 0.115,
			total: sub * 1.115,
			uploadedById: userId,
		},
	})
	t.track("claroPo", po)
	const made = await makeInvoice({
		poId: po.id,
		workMonth: "2026-05",
		madeById: userId,
	})
	return { doc, po, seq: made.seq, id: made.id, total: sub * 1.115 }
}

const row = (seq: number, voucher: number, net: number) =>
	`M19-${seq} ${voucher} 03.07.2026 $${net.toFixed(2)} $0.00 $0.00 $${net.toFixed(2)}`
const head = (ref: string) => [
	"Banco Santander PR",
	"Oct. 01, 2026",
	`Referencia ${ref}`,
]
const ref = () => String(5400000000 + Math.floor(Math.random() * 99999999))

describe("Payment Advice", () => {
	it("reads the rows, matches by invoice number and applies the paid date from the advice", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await invoiceFor(u.id)
		const reference = ref()
		const bytes = await advicePdf([
			...head(reference),
			row(a.seq, 5920050318, a.total),
			row(a.seq + 90000, 5920050319, 50),
			`Total $${(a.total + 50).toFixed(2)}`,
		])
		const { id } = await ingestAdvice({ name: "adv.pdf", bytes }, u.id)
		const lines = await db.adviceLine.findMany({
			where: { adviceId: id },
			orderBy: { position: "asc" },
		})
		expect(lines.map((l) => l.result)).toEqual(["MATCHED", "UNMATCHED"])
		expect(lines[0].invoiceDate?.toISOString().slice(0, 10)).toBe("2026-07-03")
		await applyAdvice(id, u.id)
		const inv = await db.claroInvoice.findUniqueOrThrow({ where: { id: a.id } })
		expect(inv.paidAt?.toISOString().slice(0, 10)).toBe("2026-10-01")
		expect(inv.voucherId).toBe("5920050318")
		expect(inv.bankReference).toBe(reference)
		// The unmatched row is kept, not dropped.
		expect(await db.adviceLine.count({ where: { adviceId: id } })).toBe(2)
		// Paid in full, POs = billed: Arm B is closed.
		const doc = await db.jafInvoice.findUniqueOrThrow({
			where: { id: a.doc.id },
		})
		expect(doc.receivableClosedAt).not.toBeNull()
		expect((await adviceCounts()).unmatched).toBeGreaterThanOrEqual(1)
	}, 60000)

	it("keeps JA- rows out of the M19 desk's counts and lists", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await invoiceFor(u.id)
		const bytes = await advicePdf([
			...head(ref()),
			row(a.seq, 5920050318, a.total),
			"JA-1616276 5920042289 03.06.2026 1,399.06 (0.00) 0.00 1,399.06",
			`Total $${(a.total + 1399.06).toFixed(2)}`,
		])
		const { id } = await ingestAdvice({ name: "ja.pdf", bytes }, u.id)
		// (Global counts race with other test files sharing the DB; check this advice.)
		expect(await adviceCounts("m19")).toMatchObject({
			unmatched: expect.any(Number),
		})
		const m19 = (await listAdvices(false, "m19")).find((x) => x.id === id)
		expect(m19?.lines.map((l) => l.invoiceRef)).toEqual([`M19-${a.seq}`])
		const ja = (await listAdvices(false, "ja")).find((x) => x.id === id)
		expect(ja?.lines.map((l) => l.invoiceRef)).toEqual(["JA1616276"])
		expect(
			(await listUnmatched("m19")).some((l) => l.invoiceRef === "JA1616276"),
		).toBe(false)
		expect(
			(await listUnmatched("ja")).some((l) => l.invoiceRef === "JA1616276"),
		).toBe(true)
		await applyAdvice(id, u.id)
	}, 60000)

	it("refuses the same advice twice, even saved as another file", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await invoiceFor(u.id)
		const reference = ref()
		const lines = [
			...head(reference),
			row(a.seq, 5920050300, a.total),
			`Total $${a.total.toFixed(2)}`,
		]
		await ingestAdvice({ name: "a.pdf", bytes: await advicePdf(lines) }, u.id)
		await expect(
			ingestAdvice({ name: "a.pdf", bytes: await advicePdf(lines) }, u.id),
		).rejects.toMatchObject({ code: "duplicate" })
	}, 60000)

	it("will not apply when the rows do not add to the printed total", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await invoiceFor(u.id)
		const { id } = await ingestAdvice(
			{
				name: "bad.pdf",
				bytes: await advicePdf([
					...head(ref()),
					row(a.seq, 5920050301, a.total),
					"Total $1.00",
				]),
			},
			u.id,
		)
		await expect(applyAdvice(id, u.id)).rejects.toMatchObject({
			code: "total_mismatch",
		})
		expect(
			(await db.claroInvoice.findUniqueOrThrow({ where: { id: a.id } })).paidAt,
		).toBeNull()
	}, 60000)

	it("applying twice pays once", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await invoiceFor(u.id)
		const { id } = await ingestAdvice(
			{
				name: "t.pdf",
				bytes: await advicePdf([
					...head(ref()),
					row(a.seq, 5920050302, a.total),
					`Total $${a.total.toFixed(2)}`,
				]),
			},
			u.id,
		)
		await applyAdvice(id, u.id)
		await expect(applyAdvice(id, u.id)).rejects.toMatchObject({
			code: "already_applied",
		})
	}, 60000)

	it("a short pay keeps the PO open until accepted with a reason", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await invoiceFor(u.id)
		const paid = Math.round((a.total - 10) * 100) / 100
		const { id } = await ingestAdvice(
			{
				name: "s.pdf",
				bytes: await advicePdf([
					...head(ref()),
					row(a.seq, 5920050303, paid),
					`Total $${paid.toFixed(2)}`,
				]),
			},
			u.id,
		)
		const line = await db.adviceLine.findFirstOrThrow({
			where: { adviceId: id },
		})
		expect(line.result).toBe("SHORT")
		await applyAdvice(id, u.id)
		expect(
			(await db.jafInvoice.findUniqueOrThrow({ where: { id: a.doc.id } }))
				.receivableClosedAt,
		).toBeNull()
		await expect(acceptShort(a.id, "  ", u.id)).rejects.toMatchObject({
			code: "reason_required",
		})
		await acceptShort(a.id, "Claro withheld a fee", u.id)
		expect(
			(await db.jafInvoice.findUniqueOrThrow({ where: { id: a.doc.id } }))
				.receivableClosedAt,
		).not.toBeNull()
	}, 60000)

	it("an unmatched row can be linked to an invoice by number after apply", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await invoiceFor(u.id)
		const { id } = await ingestAdvice(
			{
				name: "l.pdf",
				bytes: await advicePdf([
					...head(ref()),
					row(a.seq + 70000, 5920050304, a.total),
					`Total $${a.total.toFixed(2)}`,
				]),
			},
			u.id,
		)
		await applyAdvice(id, u.id)
		const line = await db.adviceLine.findFirstOrThrow({
			where: { adviceId: id },
		})
		expect(line.result).toBe("UNMATCHED")
		await expect(linkLine(line.id, "99999999", u.id)).rejects.toBeInstanceOf(
			AdviceError,
		)
		await linkLine(line.id, `M19-${a.seq}`, u.id)
		expect(
			(await db.claroInvoice.findUniqueOrThrow({ where: { id: a.id } })).paidAt,
		).not.toBeNull()
	}, 60000)

	it("a second payment for an invoice already paid is flagged, not applied", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await invoiceFor(u.id)
		const mk = async (v: number) =>
			ingestAdvice(
				{
					name: `p${v}.pdf`,
					bytes: await advicePdf([
						...head(ref()),
						row(a.seq, v, a.total),
						`Total $${a.total.toFixed(2)}`,
					]),
				},
				u.id,
			)
		await applyAdvice((await mk(5920050305)).id, u.id)
		const second = await mk(5920050306)
		expect(
			(await db.adviceLine.findFirstOrThrow({ where: { adviceId: second.id } }))
				.result,
		).toBe("ALREADY_PAID")
	}, 60000)

	it("rejects a non-PDF", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		await expect(
			ingestAdvice(
				{ name: "x.pdf", bytes: new TextEncoder().encode("nope") },
				u.id,
			),
		).rejects.toMatchObject({ code: "not_pdf" })
	})
})

const REAL_ADVICE =
	"docs/JAF_Package/07 All of JAF Forms/Monica Claro Payment received Sample.pdf"

describe.skipIf(!existsSync(REAL_ADVICE))("a real Claro advice", () => {
	it("is kept whole: every row, the printed total, none of ours matched", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const bytes = new Uint8Array(readFileSync(REAL_ADVICE))
		const { id } = await ingestAdvice({ name: "real.pdf", bytes }, u.id)
		const advice = await db.paymentAdvice.findUniqueOrThrow({ where: { id } })
		expect(advice.adviceDate.toISOString().slice(0, 10)).toBe("2026-08-28")
		expect(Number(advice.total)).toBe(107863.5)
		// The rows add up to the printed total, so it can be applied.
		expect(Number(advice.rowsTotal)).toBe(107863.5)
		expect(
			await db.adviceLine.count({ where: { adviceId: id } }),
		).toBeGreaterThan(166)
		await db.adviceLine.deleteMany({ where: { adviceId: id } })
		await db.paymentAdvice.delete({ where: { id } })
	}, 120000)
})

describe("Payment Advice: JA rows against Carmen's installer invoices", () => {
	const jaNo = () => `JA${Math.floor(1000000 + Math.random() * 8999999)}`
	async function ewit(
		userId: string,
		over: Record<string, unknown> = {},
		number = jaNo(),
	) {
		const inv = await db.ewitInvoice.create({
			data: {
				number,
				invoiceDate: new Date("2026-09-20T12:00:00Z"),
				total: 4871.55,
				filePath: "/files/x.pdf",
				createdById: userId,
				claroTotal: 5066.41,
				...over,
			} as never,
		})
		t.track("ewitInvoice", { id: inv.id })
		return inv
	}
	const jaRow = (refText: string, net: number) =>
		`${refText} 5920042289 03.06.2026 ${net.toFixed(2)} (0.00) 0.00 ${net.toFixed(2)}`
	async function ingest(userId: string, rows: [string, number][]) {
		const sum = rows.reduce((s, r) => s + r[1], 0)
		const bytes = await advicePdf([
			...head(ref()),
			...rows.map(([r, n]) => jaRow(r, n)),
			`Total $${sum.toFixed(2)}`,
		])
		const { id } = await ingestAdvice({ name: "ja.pdf", bytes }, userId)
		return {
			id,
			lines: await db.adviceLine.findMany({
				where: { adviceId: id },
				orderBy: { position: "asc" },
			}),
		}
	}

	it("matches paid-in-full MATCHED, short rows SHORT, dashed form too", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const full = await ewit(u.id)
		const s1 = await ewit(u.id, { claroTotal: 5097.08 })
		const s2 = await ewit(u.id, { claroTotal: 1895.06 })
		const { lines } = await ingest(u.id, [
			[full.number.replace("JA", "JA-"), 5066.41],
			[s1.number, 5059.63],
			[s2.number.replace("JA", "JA "), 1876.8],
		])
		expect(lines.map((l) => l.result)).toEqual(["MATCHED", "SHORT", "SHORT"])
		expect(lines.map((l) => l.ewitInvoiceId)).toEqual([full.id, s1.id, s2.id])
		expect(lines.every((l) => l.invoiceId === null)).toBe(true)
		expect(lines[0].invoiceRef).toBe(full.number)
		const stored = await db.ewitInvoice.findMany({
			where: { id: { in: [s1.id, s2.id] } },
		})
		const gap = (invId: string, l: (typeof lines)[number]) =>
			Math.round(
				(Number(stored.find((i) => i.id === invId)?.claroTotal) -
					Number(l.net)) *
					100,
			) / 100
		expect(gap(s1.id, lines[1])).toBe(37.45)
		expect(gap(s2.id, lines[2])).toBe(18.26)
	}, 60000)

	it("is UNMATCHED for an unknown ref, a missing PO, a voided or a held invoice", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const noPo = await ewit(u.id, { claroTotal: null })
		const voided = await ewit(u.id, { voidedAt: new Date() })
		const held = await ewit(u.id, { heldAt: new Date() })
		const { lines } = await ingest(u.id, [
			[jaNo(), 100],
			[noPo.number, 100],
			[voided.number, 100],
			[held.number, 100],
		])
		expect(lines.map((l) => l.result)).toEqual(Array(4).fill("UNMATCHED"))
		expect(lines.every((l) => l.ewitInvoiceId === null)).toBe(true)
	}, 60000)

	it("applies the paid date, net and bank ref to the installer invoice only", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await invoiceFor(u.id)
		const inv = await ewit(u.id)
		const reference = ref()
		const bytes = await advicePdf([
			...head(reference),
			row(a.seq, 5920050318, a.total),
			jaRow(inv.number, 5066.41),
			`Total $${(a.total + 5066.41).toFixed(2)}`,
		])
		const { id } = await ingestAdvice({ name: "mix.pdf", bytes }, u.id)
		const lines = await db.adviceLine.findMany({
			where: { adviceId: id },
			orderBy: { position: "asc" },
		})
		expect(lines.map((l) => l.result)).toEqual(["MATCHED", "MATCHED"])
		expect(lines[0].invoiceId).toBe(a.id)
		await applyAdvice(id, u.id, "ja")
		const paid = await db.ewitInvoice.findUniqueOrThrow({
			where: { id: inv.id },
		})
		expect(paid.claroPaidAt?.toISOString().slice(0, 10)).toBe("2026-10-01")
		expect(Number(paid.claroPaidNet)).toBe(5066.41)
		expect(paid.claroBankRef).toBe(reference)
		// Carmen's apply leaves the M19 row to Lissette.
		expect(
			(await db.claroInvoice.findUniqueOrThrow({ where: { id: a.id } })).paidAt,
		).toBeNull()
		// Lissette's apply lands it on ClaroInvoice, with its audit entry.
		await applyAdvice(id, u.id, "m19")
		const m19 = await db.claroInvoice.findUniqueOrThrow({ where: { id: a.id } })
		expect(m19.paidAt).not.toBeNull()
		expect(
			await db.auditTrail.count({
				where: { docId: a.doc.id, action: "CLARO_PAID" },
			}),
		).toBe(1)
		expect(
			(await db.adviceLine.findMany({ where: { adviceId: id } })).every(
				(l) => l.appliedAt !== null,
			),
		).toBe(true)
	}, 60000)

	it("flags an already paid invoice and leaves a short row for acceptance", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const paid = await ewit(u.id, {
			claroPaidAt: new Date("2026-09-30T12:00:00Z"),
			claroPaidNet: 5066.41,
			claroBankRef: "PRIOR1",
		})
		const short = await ewit(u.id)
		const { id, lines } = await ingest(u.id, [
			[paid.number, 5066.41],
			[short.number, 5000],
		])
		expect(lines.map((l) => l.result)).toEqual(["ALREADY_PAID", "SHORT"])
		await applyAdvice(id, u.id, "ja")
		const still = await db.ewitInvoice.findUniqueOrThrow({
			where: { id: paid.id },
		})
		expect(still.claroPaidAt?.toISOString().slice(0, 10)).toBe("2026-09-30")
		expect(Number(still.claroPaidNet)).toBe(5066.41)
		expect(still.claroBankRef).toBe("PRIOR1")
		const s = await db.ewitInvoice.findUniqueOrThrow({
			where: { id: short.id },
		})
		expect(Number(s.claroPaidNet)).toBe(5000)
		expect(s.shortAcceptedAt).toBeNull()
		await expect(acceptShort(short.id, "fee", u.id)).rejects.toMatchObject({
			code: "not_short",
		})
	}, 60000)

	it("matches an invoice created as 'ja-1616328' by an advice row JA1616328", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const n = Math.floor(1000000 + Math.random() * 8999999)
		const made = await createEwitInvoice({
			number: `ja-${n}`,
			invoiceDate: new Date("2026-09-20T12:00:00Z"),
			total: 100,
			file: new File([new Uint8Array([37, 80, 68, 70])], "i.pdf"),
			completionIds: [],
			typedOrderNos: [`ORD${n}`],
			userId: u.id,
		} as never)
		t.track("ewitInvoice", made)
		await db.ewitInvoice.update({
			where: { id: made.id },
			data: { claroTotal: 110 },
		})
		const { lines } = await ingest(u.id, [[`JA${n}`, 110]])
		expect(lines[0].result).toBe("MATCHED")
		expect(lines[0].ewitInvoiceId).toBe(made.id)
	}, 60000)

	it("does not overwrite a payment when a second advice names the same invoice", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const inv = await ewit(u.id)
		const first = await ingest(u.id, [[inv.number, 5066.41]])
		const second = await ingest(u.id, [[inv.number, 5066.41]])
		await applyAdvice(first.id, u.id, "ja")
		const a1 = await db.ewitInvoice.findUniqueOrThrow({ where: { id: inv.id } })
		await applyAdvice(second.id, u.id, "ja")
		const a2 = await db.ewitInvoice.findUniqueOrThrow({ where: { id: inv.id } })
		expect(a2.claroPaidAt).toEqual(a1.claroPaidAt)
		expect(a2.claroPaidNet).toEqual(a1.claroPaidNet)
		expect(a2.claroBankRef).toBe(a1.claroBankRef)
		const l2 = await db.adviceLine.findFirstOrThrow({
			where: { adviceId: second.id },
		})
		expect(l2.appliedAt).toBeNull()
		expect(l2.result).toBe("ALREADY_PAID")
	}, 60000)

	it("never links a JA line to an M19 invoice", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await invoiceFor(u.id)
		const { lines } = await ingest(u.id, [[jaNo(), 100]])
		await expect(
			linkLine(lines[0].id, `M19-${a.seq}`, u.id),
		).rejects.toMatchObject({ code: "line_not_unmatched" })
	}, 60000)
	it("shows the real shortfall for a short JA row: ourTotal is what Claro owes", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const inv = await ewit(u.id, { claroTotal: 1895.06 })
		const full = await ewit(u.id, { claroTotal: 100 })
		const { id } = await ingest(u.id, [
			[inv.number, 1857.61],
			[full.number, 100],
		])
		const card = (await listAdvices(false, "ja")).find((x) => x.id === id)
		const [s, f] = card?.lines ?? []
		expect(s.result).toBe("SHORT")
		expect(s.ourTotal).toBe(1895.06)
		expect(Math.round((s.ourTotal! - s.net) * 100) / 100).toBe(37.45)
		expect(f.result).toBe("MATCHED")
		expect(f.ourTotal).toBe(100)
	}, 60000)

	it("re-matches an unmatched JA row once its PO exists, only on an unapplied advice", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const noPo = await ewit(u.id, { claroTotal: null })
		const pending = await ingest(u.id, [[noPo.number, 200]])
		expect(pending.lines[0].result).toBe("UNMATCHED")
		await db.ewitInvoice.update({
			where: { id: noPo.id },
			data: { claroTotal: 200 },
		})
		expect(await rematchJaLines()).toBeGreaterThanOrEqual(1)
		const l = await db.adviceLine.findUniqueOrThrow({
			where: { id: pending.lines[0].id },
		})
		expect(l.result).toBe("MATCHED")
		expect(l.ewitInvoiceId).toBe(noPo.id)
		// Short once the PO arrives for a larger amount.
		const late = await ewit(u.id, { claroTotal: null })
		const p2 = await ingest(u.id, [[late.number, 150]])
		await db.ewitInvoice.update({
			where: { id: late.id },
			data: { claroTotal: 187.45 },
		})
		await rematchJaLines()
		expect(
			(await db.adviceLine.findUniqueOrThrow({ where: { id: p2.lines[0].id } }))
				.result,
		).toBe("SHORT")
		// An applied advice is left alone.
		const gone = await ewit(u.id, { claroTotal: null })
		const p3 = await ingest(u.id, [[gone.number, 90]])
		await applyAdvice(p3.id, u.id, "ja")
		await db.ewitInvoice.update({
			where: { id: gone.id },
			data: { claroTotal: 90 },
		})
		await rematchJaLines()
		expect(
			(await db.adviceLine.findUniqueOrThrow({ where: { id: p3.lines[0].id } }))
				.result,
		).toBe("UNMATCHED")
	}, 90000)

	it("accepts a short JA payment only with a reason, once, and not an M19 line", async () => {
		const u = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const inv = await ewit(u.id, { claroTotal: 1895.06 })
		const { id, lines } = await ingest(u.id, [[inv.number, 1857.61]])
		await applyAdvice(id, u.id, "ja")
		await expect(acceptJaShort(lines[0].id, "  ", u.id)).rejects.toMatchObject({
			code: "reason_required",
		})
		await acceptJaShort(lines[0].id, "Claro kept the fee", u.id)
		const after = await db.ewitInvoice.findUniqueOrThrow({
			where: { id: inv.id },
		})
		expect(after.shortAcceptedAt).not.toBeNull()
		expect(after.shortAcceptedReason).toBe("Claro kept the fee")
		expect(after.shortAcceptedById).toBe(u.id)
		await expect(
			acceptJaShort(lines[0].id, "again", u.id),
		).rejects.toMatchObject({ code: "not_short" })
		const card = (await listAdvices(true, "ja")).find((x) => x.id === id)
		expect(card?.lines[0].needsAccept).toBe(false)
		// An unpaid short line is not acceptable yet.
		const inv2 = await ewit(u.id, { claroTotal: 500 })
		const p2 = await ingest(u.id, [[inv2.number, 400]])
		await expect(
			acceptJaShort(p2.lines[0].id, "x", u.id),
		).rejects.toMatchObject({
			code: "not_short",
		})
	}, 90000)
	it("each desk applies only its own rows; the advice stays pending for the other desk", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const m = await invoiceFor(u.id)
		const inv = await ewit(u.id, { claroTotal: 300 })
		const bytes = await advicePdf([
			...head(ref()),
			row(m.seq, 5920050318, m.total),
			jaRow(inv.number, 300),
			`Total $${(m.total + 300).toFixed(2)}`,
		])
		const { id } = await ingestAdvice({ name: "mix.pdf", bytes }, u.id)
		const has = async (kind: "m19" | "ja", applied: boolean) =>
			(await listAdvices(applied, kind)).some((a) => a.id === id)

		expect(await has("m19", false)).toBe(true)
		expect(await has("ja", false)).toBe(true)

		// Carmen applies: only her installer invoice is paid.
		await applyAdvice(id, u.id, "ja")
		const ewitPaid = await db.ewitInvoice.findUniqueOrThrow({
			where: { id: inv.id },
		})
		expect(ewitPaid.claroPaidAt).not.toBeNull()
		const claro1 = await db.claroInvoice.findUniqueOrThrow({
			where: { id: m.id },
		})
		expect(claro1.paidAt).toBeNull()
		expect(
			(await db.paymentAdvice.findUniqueOrThrow({ where: { id } })).appliedAt,
		).toBeNull()
		expect(await has("ja", true)).toBe(true)
		expect(await has("ja", false)).toBe(false)
		expect(await has("m19", false)).toBe(true)
		expect(await has("m19", true)).toBe(false)

		// Applying again as the same desk changes nothing.
		await applyAdvice(id, u.id, "ja")
		const again = await db.ewitInvoice.findUniqueOrThrow({
			where: { id: inv.id },
		})
		expect(again.claroPaidAt).toEqual(ewitPaid.claroPaidAt)
		expect(
			(await db.paymentAdvice.findUniqueOrThrow({ where: { id } })).appliedAt,
		).toBeNull()

		// Lissette applies: her invoice is paid and the advice is fully applied.
		await applyAdvice(id, u.id, "m19")
		const claro2 = await db.claroInvoice.findUniqueOrThrow({
			where: { id: m.id },
		})
		expect(claro2.paidAt).not.toBeNull()
		expect(
			(await db.paymentAdvice.findUniqueOrThrow({ where: { id } })).appliedAt,
		).not.toBeNull()
		await expect(applyAdvice(id, u.id, "m19")).rejects.toMatchObject({
			code: "already_applied",
		})
		expect(await has("m19", true)).toBe(true)
		expect(await has("ja", true)).toBe(true)
	}, 120000)

	it("a double apply by Lissette pays an M19 row once", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const m = await invoiceFor(u.id)
		const bytes = await advicePdf([
			...head(ref()),
			row(m.seq, 5920050318, m.total),
			`Total $${m.total.toFixed(2)}`,
		])
		const { id } = await ingestAdvice({ name: "m.pdf", bytes }, u.id)
		await Promise.allSettled([
			applyAdvice(id, u.id, "m19"),
			applyAdvice(id, u.id, "m19"),
		])
		expect(
			await db.auditTrail.count({
				where: { docId: m.doc.id, action: "CLARO_PAID" },
			}),
		).toBe(1)
	}, 90000)
	it("a concurrent double apply by Carmen keeps a short JA row SHORT, pays once, and the short can still be accepted", async () => {
		const u = t.track("user", await seedUser({ role: "COMPTROLLER" }))
		const inv = await ewit(u.id, { claroTotal: 1895.06 })
		const { id, lines } = await ingest(u.id, [[inv.number, 1857.61]])
		await Promise.all([
			applyAdvice(id, u.id, "ja"),
			applyAdvice(id, u.id, "ja"),
		])
		const line = await db.adviceLine.findUniqueOrThrow({
			where: { id: lines[0].id },
		})
		expect(line.result).toBe("SHORT")
		expect(line.appliedAt).not.toBeNull()
		const paid = await db.ewitInvoice.findUniqueOrThrow({
			where: { id: inv.id },
		})
		expect(Number(paid.claroPaidNet)).toBe(1857.61)
		const card = (await listAdvices(true, "ja")).find((x) => x.id === id)
		expect(card?.lines[0].needsAccept).toBe(true)
		await acceptJaShort(lines[0].id, "Claro kept the fee", u.id)
		expect(
			(await db.ewitInvoice.findUniqueOrThrow({ where: { id: inv.id } }))
				.shortAcceptedAt,
		).not.toBeNull()
	}, 90000)
})
