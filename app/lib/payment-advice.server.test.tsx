import { existsSync, readFileSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Document, Page, renderToBuffer, Text } from "@react-pdf/renderer"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { makeInvoice } from "~/lib/claro-invoice.server"
import { db } from "~/lib/db.server"
import {
	AdviceError,
	acceptShort,
	adviceCounts,
	applyAdvice,
	ingestAdvice,
	linkLine,
	listOtherJaf,
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

	it("keeps JA- rows as their own group, not as unmatched errors", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		const a = await invoiceFor(u.id)
		const before = await adviceCounts()
		const beforeJa = await listOtherJaf()
		const bytes = await advicePdf([
			...head(ref()),
			row(a.seq, 5920050318, a.total),
			"JA-1616276 5920042289 03.06.2026 1,399.06 (0.00) 0.00 1,399.06",
			`Total $${(a.total + 1399.06).toFixed(2)}`,
		])
		const { id } = await ingestAdvice({ name: "ja.pdf", bytes }, u.id)
		expect((await adviceCounts()).unmatched).toBe(before.unmatched)
		const ja = await listOtherJaf()
		expect(ja.lines.length).toBe(beforeJa.lines.length + 1)
		expect(ja.total).toBeCloseTo(beforeJa.total + 1399.06, 2)
		expect(ja.lines.some((l) => l.invoiceRef === "JA-1616276")).toBe(true)
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
