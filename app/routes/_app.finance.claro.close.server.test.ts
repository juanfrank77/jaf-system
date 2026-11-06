import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/system-settings.server", async (original) => ({
	...(await original<typeof import("~/lib/system-settings.server")>()),
	getInvoiceSignature: async () =>
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
}))

import { Document, Page, renderToBuffer, Text } from "@react-pdf/renderer"
import { createElement } from "react"
import { addOldInvoice, makeInvoice } from "~/lib/claro-invoice.server"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import {
	makeTracker,
	runToken,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"
import routes from "../routes"
import { action, loader } from "./_app.finance.claro.close"

const t = makeTracker()
let dir: string
const prev = process.env.UPLOAD_DIR
let userId: string

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "claro-close-"))
	process.env.UPLOAD_DIR = dir
	const u = t.track("user", await seedUser({ role: "FINANCE" }))
	userId = u.id
	vi.mocked(requireRole).mockResolvedValue({ user: u } as never)
})
afterAll(async () => {
	await t.cleanup()
	process.env.UPLOAD_DIR = prev
	await fs.rm(dir, { recursive: true, force: true })
})

async function pdf(lines: string[]) {
	const buf = await renderToBuffer(
		createElement(
			Document,
			null,
			createElement(
				Page,
				{ size: "LETTER" },
				...lines.map((l) => createElement(Text, { key: l }, l)),
			),
		),
	)
	return new Uint8Array(buf)
}

async function m20Invoice() {
	const doc = t.track("jafInvoice", await seedFinanceableInvoice())
	const po = t.track(
		"claroPo",
		await db.claroPo.create({
			data: {
				poNumber: String(4500000000 + Math.floor(Math.random() * 99999999)),
				poDate: new Date("2026-09-04T12:00:00Z"),
				termsDays: 60,
				filePath: "x",
				fileName: "x.pdf",
				fileHash: runToken("h"),
				status: "CONFIRMED",
				docId: doc.id,
				subtotal: 100,
				ivu4: 0,
				ivu115: 11.5,
				total: 111.5,
				uploadedById: userId,
			},
		}),
	)
	const inv = await makeInvoice({
		poId: po.id,
		workMonth: "2026-05",
		madeById: userId,
	})
	return { doc, seq: inv.seq, id: inv.id, total: 111.5 }
}

const row = (ref: string, voucher: number, net: number) =>
	`${ref} ${voucher} 03.07.2026 $${net.toFixed(2)} $0.00 $0.00 $${net.toFixed(2)}`
const head = () => [
	"Banco Santander PR",
	"Oct. 01, 2026",
	`Referencia ${String(5400000000 + Math.floor(Math.random() * 99999999))}`,
]
const money = (n: number) => `Total $${n.toFixed(2)}`

const req = (form?: FormData) =>
	new Request(
		"http://localhost/finance/claro/close",
		form ? { method: "POST", body: form } : undefined,
	)
const post = (form: FormData) =>
	action({ request: req(form), params: {}, context: {} } as never) as Promise<{
		errorKey?: string
		adviceId?: string
	}>
const get = () =>
	loader({ request: req(), params: {}, context: {} } as never) as Promise<{
		advices: {
			id: string
			lines: {
				id: string
				invoiceRef: string
				result: string
				invoiceId: string | null
				needsAccept: boolean
			}[]
		}[]
		unmatched: { id: string; invoiceRef: string }[]
		shorts: { id: string; invoiceId: string | null }[]
	}>
async function upload(bytes: Uint8Array, name = "s.pdf") {
	const form = new FormData()
	form.set("intent", "upload")
	form.set(
		"file",
		new File([bytes as BlobPart], name, { type: "application/pdf" }),
	)
	return post(form)
}
const find = async (adviceId: string) =>
	(await get()).advices.find((a) => a.id === adviceId)

describe("Claro Close step", () => {
	it("closes an M20 line and an old M19 line with the statement's payment date", async () => {
		const a = await m20Invoice()
		const seq = 40_000 + Math.floor(Math.random() * 9_999)
		const old = await addOldInvoice({
			number: `M19-${seq}`,
			total: 200,
			poNumber: null,
			loadedAt: null,
			userId,
		})
		const res = await upload(
			await pdf([
				...head(),
				row(`M20-${a.seq}`, 5920050401, a.total),
				row(`M19-${seq}`, 5920050402, 200),
				money(a.total + 200),
			]),
		)
		expect(res.errorKey).toBeUndefined()
		expect(res.adviceId).toBeTruthy()
		const adviceId = res.adviceId as string
		const card = await find(adviceId)
		expect(card?.lines.map((l) => l.result)).toEqual(["MATCHED", "MATCHED"])
		const apply = new FormData()
		apply.set("intent", "apply")
		apply.set("adviceId", adviceId)
		expect(await post(apply)).toEqual({})
		for (const id of [a.id, old.id]) {
			const inv = await db.claroInvoice.findUniqueOrThrow({ where: { id } })
			expect(inv.paidAt?.toISOString().slice(0, 10)).toBe("2026-10-01")
		}
	}, 90000)

	it("a short line is flagged, does not close the receivable, and accept_short closes it", async () => {
		const a = await m20Invoice()
		const paid = a.total - 10
		const res = await upload(
			await pdf([
				...head(),
				row(`M20-${a.seq}`, 5920050403, paid),
				money(paid),
			]),
		)
		const adviceId = res.adviceId as string
		const card = await find(adviceId)
		expect(card?.lines[0].result).toBe("SHORT")
		const apply = new FormData()
		apply.set("intent", "apply")
		apply.set("adviceId", adviceId)
		await post(apply)
		expect(
			(await db.jafInvoice.findUniqueOrThrow({ where: { id: a.doc.id } }))
				.receivableClosedAt,
		).toBeNull()
		// Paid short, the advice leaves pending but the line stays on screen.
		expect((await get()).shorts.some((x) => x.invoiceId === a.id)).toBe(true)
		const acc = new FormData()
		acc.set("intent", "accept_short")
		acc.set("invoiceId", a.id)
		acc.set("reason", "Claro withheld a fee")
		expect(await post(acc)).toEqual({})
		expect(
			(await db.jafInvoice.findUniqueOrThrow({ where: { id: a.doc.id } }))
				.receivableClosedAt,
		).not.toBeNull()
		expect((await get()).shorts.some((x) => x.invoiceId === a.id)).toBe(false)
	}, 90000)

	it("lists an unmatched line, link resolves it, and a JA row is never shown", async () => {
		const a = await m20Invoice()
		const res = await upload(
			await pdf([
				...head(),
				row(`M20-${a.seq + 70000}`, 5920050404, a.total),
				"JA-1616277 5920042290 03.06.2026 1,399.06 (0.00) 0.00 1,399.06",
				money(a.total + 1399.06),
			]),
		)
		const adviceId = res.adviceId as string
		const page = await get()
		const card = page.advices.find((x) => x.id === adviceId)
		expect(card?.lines.map((l) => l.invoiceRef)).toEqual([
			`M20-${a.seq + 70000}`,
		])
		expect(page.unmatched.some((u) => u.invoiceRef.startsWith("JA"))).toBe(
			false,
		)
		const line = card?.lines[0]
		expect(line?.result).toBe("UNMATCHED")
		expect(page.unmatched.some((u) => u.id === line?.id)).toBe(true)
		const link = new FormData()
		link.set("intent", "link")
		link.set("lineId", line?.id ?? "")
		link.set("invoice", "99999999")
		expect(await post(link)).toMatchObject({
			errorKey: "payment_advice.errors.invoice_not_found",
		})
		link.set("invoice", `M20-${a.seq}`)
		expect(await post(link)).toEqual({})
		expect((await find(adviceId))?.lines[0].result).toBe("MATCHED")
	}, 90000)

	it("a statement with only an already-paid line, or only an unmatched line, can be marked reviewed", async () => {
		const a = await m20Invoice()
		const first = await upload(
			await pdf([
				...head(),
				row(`M20-${a.seq}`, 5920050405, a.total),
				money(a.total),
			]),
		)
		const apply = (id: string) => {
			const f = new FormData()
			f.set("intent", "apply")
			f.set("adviceId", id)
			return post(f)
		}
		await apply(first.adviceId as string)
		// The same invoice again on a new statement: already paid.
		const again = await upload(
			await pdf([
				...head(),
				row(`M20-${a.seq}`, 5920050406, a.total),
				money(a.total),
			]),
		)
		const againId = again.adviceId as string
		expect((await find(againId))?.lines[0].result).toBe("ALREADY_PAID")
		expect(await apply(againId)).toEqual({})
		expect(await find(againId)).toBeUndefined()
		// Only an unmatched line.
		const ref = `M20-${a.seq + 60000}`
		const un = await upload(
			await pdf([...head(), row(ref, 5920050407, 55), money(55)]),
		)
		const unId = un.adviceId as string
		const unLine = (await find(unId))?.lines[0]
		expect(unLine?.result).toBe("UNMATCHED")
		expect(await apply(unId)).toEqual({})
		const page = await get()
		expect(page.advices.some((x) => x.id === unId)).toBe(false)
		expect(page.unmatched.some((u) => u.id === unLine?.id)).toBe(true)
	}, 90000)

	it("accept_short needs a reason; a double apply pays nothing twice", async () => {
		const a = await m20Invoice()
		const paid = a.total - 10
		const res = await upload(
			await pdf([
				...head(),
				row(`M20-${a.seq}`, 5920050408, paid),
				money(paid),
			]),
		)
		const id = res.adviceId as string
		const apply = new FormData()
		apply.set("intent", "apply")
		apply.set("adviceId", id)
		expect(await post(apply)).toEqual({})
		const before = await db.claroInvoice.findUniqueOrThrow({
			where: { id: a.id },
		})
		expect(await post(apply)).toMatchObject({
			errorKey: "payment_advice.errors.already_applied",
		})
		const after = await db.claroInvoice.findUniqueOrThrow({
			where: { id: a.id },
		})
		expect(after.paidAt).toEqual(before.paidAt)
		expect(Number(after.paidNet)).toBe(Number(before.paidNet))
		const acc = new FormData()
		acc.set("intent", "accept_short")
		acc.set("invoiceId", a.id)
		acc.set("reason", "  ")
		expect(await post(acc)).toMatchObject({
			errorKey: "payment_advice.errors.reason_required",
		})
		expect(
			(await db.claroInvoice.findUniqueOrThrow({ where: { id: a.id } }))
				.shortAcceptedAt,
		).toBeNull()
	}, 90000)

	it("a statement with a JA row leaves this screen once the M19 rows are paid", async () => {
		const a = await m20Invoice()
		const res = await upload(
			await pdf([
				...head(),
				row(`M20-${a.seq}`, 5920050409, a.total),
				"JA-1616278 5920042291 03.06.2026 1,399.06 (0.00) 0.00 1,399.06",
				money(a.total + 1399.06),
			]),
		)
		const id = res.adviceId as string
		expect(await find(id)).toBeDefined()
		const apply = new FormData()
		apply.set("intent", "apply")
		apply.set("adviceId", id)
		expect(await post(apply)).toEqual({})
		expect(
			(await db.claroInvoice.findUniqueOrThrow({ where: { id: a.id } })).paidAt,
		).not.toBeNull()
		// An unmatched JA row is not payable, so it does not hold the statement
		// open; a matched one would, and listAdvices' desk-done filter still
		// drops the statement from this screen once the M19 rows are paid.
		expect(await find(id)).toBeUndefined()
	}, 90000)

	it("refuses a non-FINANCE role on the action", async () => {
		vi.mocked(requireRole).mockRejectedValueOnce(
			new Response("no", { status: 403 }),
		)
		const f = new FormData()
		f.set("intent", "apply")
		f.set("adviceId", "x")
		await expect(post(f)).rejects.toMatchObject({ status: 403 })
	})

	it("refuses a non-FINANCE role", async () => {
		vi.mocked(requireRole).mockRejectedValueOnce(
			new Response("no", { status: 403 }),
		)
		await expect(get()).rejects.toMatchObject({ status: 403 })
	})

	it("answers a non-PDF or missing upload with an error key", async () => {
		const form = new FormData()
		form.set("intent", "upload")
		form.set("file", new File(["hello"], "a.txt", { type: "text/plain" }))
		expect(await post(form)).toMatchObject({
			errorKey: "payment_advice.errors.not_pdf",
		})
		const none = new FormData()
		none.set("intent", "upload")
		expect(await post(none)).toMatchObject({
			errorKey: "payment_advice.errors.no_file",
		})
	})

	it("the loader answers on /finance/claro/close, registered before :id", async () => {
		const data = await get()
		expect(Array.isArray(data.advices)).toBe(true)
		const flat: string[] = []
		const walk = (
			rs: readonly { path?: string; children?: readonly unknown[] }[],
		) => {
			for (const r of rs) {
				if (r.path) flat.push(r.path)
				if (r.children) walk(r.children as never)
			}
		}
		walk(routes as never)
		expect(flat.indexOf("finance/claro/close")).toBeGreaterThan(-1)
		expect(flat.indexOf("finance/claro/close")).toBeLessThan(
			flat.indexOf("finance/claro/:id"),
		)
	})
})
