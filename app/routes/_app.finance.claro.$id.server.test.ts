import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { redirect } from "react-router"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	user: { id: "", role: "FINANCE" as string },
	signature: vi.fn(),
}))
// Mirrors the real guard: a role outside `allowed` is sent away.
vi.mock("~/lib/permissions.server", () => ({
	requireRole: vi.fn(async (_req: Request, allowed: string[]) => {
		if (!allowed.includes(mocks.user.role)) throw redirect("/dashboard")
		return { user: mocks.user }
	}),
}))
vi.mock("~/lib/po-inbox.server", async (orig) => ({
	...(await orig<typeof import("~/lib/po-inbox.server")>()),
	kickProcessing: vi.fn(),
}))
vi.mock("~/lib/system-settings.server", async (orig) => ({
	...(await orig<typeof import("~/lib/system-settings.server")>()),
	getInvoiceSignature: mocks.signature,
}))

import { db } from "~/lib/db.server"
import {
	evaluatePo,
	ingestPoFiles,
	kickProcessing,
	processPending,
} from "~/lib/po-inbox.server"
import type { PoReader } from "~/lib/po-reader.server"
import type { PoRead } from "~/lib/po-reading"
import {
	makeTracker,
	runToken,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"
import { action, loader } from "./_app.finance.claro.$id"
import { loader as fileLoader } from "./_app.finance.claro.$id.file"
import { loader as invoiceLoader } from "./_app.finance.claro.$id.invoice"

const PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

const t = makeTracker()
let dir: string
const prev = process.env.UPLOAD_DIR
let userId: string

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "claro-detail-"))
	process.env.UPLOAD_DIR = dir
	const u = t.track("user", await seedUser({ role: "FINANCE" }))
	userId = u.id
	mocks.user.id = u.id
	mocks.signature.mockResolvedValue(PNG)
})
afterAll(async () => {
	await t.cleanup()
	process.env.UPLOAD_DIR = prev
	await fs.rm(dir, { recursive: true, force: true })
})

/** A PDF with `pages` pages whose bytes differ per tag. */
function pdf(tag: string, pages = 1): Uint8Array<ArrayBuffer> {
	const objs = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${3 + i} 0 R`).join(" ")}] /Count ${pages} >>`,
		...Array.from(
			{ length: pages },
			() => "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>",
		),
	]
	let out = "%PDF-1.4\n"
	const offs: number[] = []
	objs.forEach((o, i) => {
		offs.push(out.length)
		out += `${i + 1} 0 obj\n${o}\n% ${tag}\nendobj\n`
	})
	const x = out.length
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
	for (const o of offs) out += `${String(o).padStart(10, "0")} 00000 n \n`
	out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`
	return new TextEncoder().encode(out)
}

const poNumber = () => String(4500000000 + Math.floor(Math.random() * 99999999))

async function billedDoc() {
	return t.track(
		"jafInvoice",
		await seedFinanceableInvoice({
			avisoNumber: String(10000000 + Math.floor(Math.random() * 89999999)),
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
}

/** A read PO on Review: one 100.00 line at 11.5%, billed 500 on its Aviso. */
async function reviewPo(
	over: Partial<{
		statedPages: number
		termsDays: number | null
		status: "NEEDS_LOOK" | "CONFIRMED"
		poNumber: string
		/** Fields set last, over the defaults (status, docId, lines, ...). */
		extra: Record<string, unknown>
	}> = {},
) {
	const doc = await billedDoc()
	const po = await db.claroPo.create({
		data: {
			poNumber: over.poNumber ?? poNumber(),
			poDate: new Date("2026-09-04T12:00:00Z"),
			termsDays: over.termsDays === undefined ? 60 : over.termsDays,
			statedPages: over.statedPages ?? 1,
			filePages: 1,
			filePath: "x",
			fileName: "x.pdf",
			fileHash: runToken("h"),
			status: over.status ?? "NEEDS_LOOK",
			docId: doc.id,
			lines: [
				{
					item: "10",
					description: "x",
					amount: 100,
					ivuRate: 0.115,
					ivu: 11.5,
				},
			],
			subtotal: 100,
			ivu4: 0,
			ivu115: 11.5,
			total: 111.5,
			printed: { subtotal: 100, ivu4: 0, ivu115: 11.5, total: 111.5 },
			uploadedById: userId,
			...(over.status === "CONFIRMED"
				? { confirmedAt: new Date(), confirmedById: userId }
				: {}),
			...over.extra,
		} as never,
	})
	t.track("claroPo", po)
	return { ...po, avisoNumber: doc.avisoNumber as string }
}

async function seedInvoice(poId: string, docId: string, loaded = false) {
	return db.claroInvoice.create({
		data: {
			series: runToken("S"),
			seq: 1,
			claroPoId: poId,
			docId,
			workMonth: "2026-08",
			subtotal: 100,
			ivu4: 0,
			ivu115: 11.5,
			total: 111.5,
			madeById: userId,
			loadedAt: loaded ? new Date("2026-10-01T12:00:00Z") : null,
		},
	})
}

const url = (id: string, q = "") => `http://localhost/finance/claro/${id}${q}`
const load = (id: string, q = "") =>
	loader({
		request: new Request(url(id, q)),
		params: { id },
		context: {},
	} as never).catch((r: unknown) => r)
const post = (id: string, fields: Record<string, string | File>) => {
	const form = new FormData()
	for (const [k, v] of Object.entries(fields)) form.set(k, v)
	return action({
		request: new Request(url(id), { method: "POST", body: form }),
		params: { id },
		context: {},
	} as never).catch((r: unknown) => r)
}
const header = (po: { poNumber: string | null }) => ({
	poNumber: po.poNumber ?? "",
	poDate: "2026-09-04",
	termsDays: "60",
	statedPages: "1",
	subtotal: "100",
	ivu4: "0",
	ivu115: "11.5",
	total: "111.5",
	avisoNumber: "",
})
const location = (r: unknown) =>
	r instanceof Response ? r.headers.get("Location") : null
const codes = (v: unknown) => (v as { code: string }[]).map((c) => c.code)

describe("/finance/claro/:id Review", () => {
	it("fix with a changed line rebuilds the totals and leaves the rest untouched", async () => {
		const po = await reviewPo()
		const res = await post(po.id, {
			intent: "fix",
			...header(po),
			lines: JSON.stringify([
				{ item: "10", description: "Poste", amount: 200, ivuRate: 0.115 },
			]),
		})
		expect(res).toEqual({ saved: true })
		const row = await db.claroPo.findUniqueOrThrow({ where: { id: po.id } })
		expect(Number(row.subtotal)).toBe(200)
		expect(Number(row.ivu115)).toBe(23)
		expect(Number(row.total)).toBe(223)
		// The header came back as it was: only the lines count as typed.
		expect(Object.keys(row.entered as object)).toEqual(["lines"])
		expect(row.printed).toEqual({
			subtotal: 100,
			ivu4: 0,
			ivu115: 11.5,
			total: 111.5,
		})
		expect(codes(row.checks)).toContain("lines_sum")
	})

	it("fix refuses a number that is not a number, and a malformed line", async () => {
		const po = await reviewPo()
		expect(
			await post(po.id, { intent: "fix", ...header(po), total: "1e999" }),
		).toEqual({ errorKey: "claro.errors.bad_number" })
		expect(
			await post(po.id, {
				intent: "fix",
				...header(po),
				lines: JSON.stringify([{ item: "10", description: "x", amount: "x" }]),
			}),
		).toEqual({ errorKey: "claro.errors.bad_lines" })
		const row = await db.claroPo.findUniqueOrThrow({ where: { id: po.id } })
		expect(Number(row.total)).toBe(111.5)
		expect(row.entered).toBeNull()
	})

	it("generate with a red check and no reason says so; with a reason makes an M20 and moves on", async () => {
		const po = await reviewPo({ termsDays: null })
		expect(
			await post(po.id, { intent: "generate", workMonth: "2026-08" }),
		).toEqual({ errorKey: "claro.errors.reason_required" })
		expect(await db.claroInvoice.count({ where: { claroPoId: po.id } })).toBe(0)
		const res = await post(po.id, {
			intent: "generate",
			workMonth: "2026-08",
			"override-terms_missing": "60 days per contract",
		})
		expect(location(res)).toBe(`/finance/claro/${po.id}?step=generate`)
		const inv = await db.claroInvoice.findUniqueOrThrow({
			where: { claroPoId: po.id },
		})
		expect(inv.series).toBe("M20")
		expect(inv.workMonth).toBe("2026-08")
	})

	it("generate on a PO with missing pages returns an error and makes nothing", async () => {
		const po = await reviewPo({ statedPages: 3 })
		expect(
			await post(po.id, {
				intent: "generate",
				workMonth: "2026-08",
				"override-pages_missing": "it is all there",
			}),
		).toEqual({ errorKey: "claro.errors.hard_stop" })
		expect(await db.claroInvoice.count({ where: { claroPoId: po.id } })).toBe(0)
		expect(
			(await db.claroPo.findUniqueOrThrow({ where: { id: po.id } })).status,
		).toBe("BLOCKED")
	})

	it("upload_complete takes a complete file that supersedes the short one once read", async () => {
		const doc = await billedDoc()
		const number = poNumber()
		const read: PoRead = {
			poNumber: number,
			poDate: "2026-09-04",
			statedPages: 2,
			termsDays: 60,
			avisoCandidates: [doc.avisoNumber as string],
			lines: [
				{
					item: "10",
					description: "x",
					amount: 100,
					ivuRate: 0.115,
					ivu: 11.5,
				},
			],
			subtotal: 100,
			ivu4: 0,
			ivu115: 11.5,
			total: 111.5,
		}
		const reader: PoReader = async () => read
		const tagA = runToken("short")
		const [a] = await ingestPoFiles(
			[{ name: "short.pdf", bytes: pdf(tagA, 1) }],
			userId,
		)
		t.track("claroPo", { id: a })
		await processPending(reader, 1)
		const before = await db.claroPo.findUniqueOrThrow({ where: { id: a } })
		expect(codes(before.checks)).toContain("pages_missing")

		const tagB = runToken("full")
		const res = await post(a, {
			intent: "upload_complete",
			file: new File([pdf(tagB, 2)], "full.pdf", { type: "application/pdf" }),
		})
		const b = await db.claroPo.findFirstOrThrow({
			where: { fileName: "full.pdf", uploadedById: userId },
			orderBy: { receivedAt: "desc" },
		})
		t.track("claroPo", b)
		expect(location(res)).toBe(`/finance/claro/${b.id}?step=review`)
		await processPending(reader, 1)
		const old = await db.claroPo.findUniqueOrThrow({ where: { id: a } })
		expect(old.status).toBe("SUPERSEDED")
		expect(old.supersededById).toBe(b.id)
	})

	it("discard retires a duplicate copy only", async () => {
		const number = poNumber()
		const original = await reviewPo({ poNumber: number, status: "CONFIRMED" })
		const copy = await reviewPo({ poNumber: number })
		await evaluatePo(copy.id)
		const other = await reviewPo({ termsDays: null })
		const page = (await load(copy.id)) as { po: { original: { id: string } } }
		expect(page.po.original.id).toBe(original.id)

		expect(await post(other.id, { intent: "discard" })).toEqual({
			errorKey: "claro.errors.not_discardable",
		})
		expect(
			(await db.claroPo.findUniqueOrThrow({ where: { id: other.id } })).status,
		).not.toBe("SUPERSEDED")

		const res = await post(copy.id, { intent: "discard" })
		expect(location(res)).toBe(`/finance/claro/${original.id}`)
		const row = await db.claroPo.findUniqueOrThrow({ where: { id: copy.id } })
		expect(row.status).toBe("SUPERSEDED")
		expect(row.supersededById).toBe(original.id)
	})
	it("an Unmatched PO says it needs an Aviso, and generates once one is saved", async () => {
		const po = await reviewPo({
			extra: { status: "UNMATCHED", docId: null },
		})
		const page = (await load(po.id)) as {
			po: { avisoNumber: string | null; status: string }
		}
		expect(page.po.avisoNumber).toBeNull()
		expect(
			await post(po.id, { intent: "generate", workMonth: "2026-08" }),
		).toEqual({ errorKey: "claro.errors.aviso_missing" })
		expect(
			await post(po.id, {
				intent: "fix",
				...header(po),
				avisoNumber: po.avisoNumber,
			}),
		).toEqual({ saved: true })
		const res = await post(po.id, { intent: "generate", workMonth: "2026-08" })
		expect(location(res)).toBe(`/finance/claro/${po.id}?step=generate`)
	})

	it("the money header is what the PO printed: a second save typing the rebuilt subtotal updates printed and greens the checks", async () => {
		// The reader misread line 10 as 10.00 and the printed subtotal as 50.00.
		const po = await reviewPo({
			extra: {
				lines: [
					{
						item: "10",
						description: "x",
						amount: 10,
						ivuRate: 0.115,
						ivu: 11.5,
					},
				],
				subtotal: 50,
				printed: { subtotal: 50, ivu4: 0, ivu115: 11.5, total: 111.5 },
			},
		})
		const asPrinted = { ...header(po), subtotal: "50" }
		const line100 = JSON.stringify([
			{ item: "10", description: "x", amount: 100, ivuRate: 0.115 },
		])
		// Save 1: the line. Stored is rebuilt from lines; printed stays.
		expect(
			await post(po.id, { intent: "fix", ...asPrinted, lines: line100 }),
		).toEqual({ saved: true })
		let row = await db.claroPo.findUniqueOrThrow({ where: { id: po.id } })
		expect(Number(row.subtotal)).toBe(100)
		expect((row.printed as { subtotal: number }).subtotal).toBe(50)
		expect(codes(row.checks)).toContain("lines_sum")
		// The form shows what was printed, 50, not the rebuilt 100.
		const page = (await load(po.id)) as {
			po: { printed: { subtotal: number } }
		}
		expect(page.po.printed.subtotal).toBe(50)
		// Save 2: the subtotal the PO really printed, equal to the rebuilt value.
		expect(
			await post(po.id, {
				intent: "fix",
				...asPrinted,
				subtotal: "100",
				lines: line100,
			}),
		).toEqual({ saved: true })
		row = await db.claroPo.findUniqueOrThrow({ where: { id: po.id } })
		expect((row.printed as { subtotal: number }).subtotal).toBe(100)
		expect(Object.keys(row.entered as object)).toContain("subtotal")
		expect(codes(row.checks)).not.toContain("lines_sum")
		expect(codes(row.checks)).not.toContain("totals")
	})

	it("fix validates each field and answers with a key, never a 500", async () => {
		const po = await reviewPo()
		const line = (o: Record<string, unknown>) =>
			JSON.stringify([
				{ item: "10", description: "x", amount: 100, ivuRate: 0.115, ...o },
			])
		const bad: [Record<string, string>, string][] = [
			[{ lines: line({ ivuRate: 0.07 }) }, "claro.errors.bad_lines"],
			[{ lines: line({ amount: -5 }) }, "claro.errors.bad_lines"],
			[{ lines: line({ amount: 2e9 }) }, "claro.errors.bad_lines"],
			[{ termsDays: "400" }, "claro.errors.bad_number"],
			[{ termsDays: "-1" }, "claro.errors.bad_number"],
			[{ statedPages: "0" }, "claro.errors.bad_number"],
			[{ statedPages: "100" }, "claro.errors.bad_number"],
			[{ subtotal: "-1" }, "claro.errors.bad_number"],
			[{ total: "2000000000" }, "claro.errors.bad_number"],
			[{ poDate: "2026-02-31" }, "claro.errors.bad_number"],
			[{ poNumber: "PO" }, "claro.errors.bad_po_number"],
			[{ poNumber: "" }, "claro.errors.bad_po_number"],
		]
		for (const [field, key] of bad)
			expect(
				await post(po.id, { intent: "fix", ...header(po), ...field }),
			).toEqual({
				errorKey: key,
			})
		const row = await db.claroPo.findUniqueOrThrow({ where: { id: po.id } })
		expect(row.entered).toBeNull()
		expect(row.poNumber).toBe(po.poNumber)
	})

	it("a row still being read or replaced answers not_ready to every intent", async () => {
		// READING, not PENDING: a parallel test's processPending claims PENDING rows.
		const pending = await reviewPo({ extra: { status: "READING" } })
		const gone = await reviewPo({ extra: { status: "SUPERSEDED" } })
		for (const id of [pending.id, gone.id])
			for (const intent of [
				"fix",
				"generate",
				"upload_complete",
				"discard",
				"submit",
			])
				expect(await post(id, { intent })).toEqual({
					errorKey: "claro.errors.not_ready",
				})
	})

	it("no Discard link when the only earlier twin is stopped on missing pages", async () => {
		const number = poNumber()
		await reviewPo({
			poNumber: number,
			extra: {
				status: "BLOCKED",
				statedPages: 2,
				checks: [{ code: "pages_missing", severity: "blocked" }],
				receivedAt: new Date(Date.now() - 60_000),
			},
		})
		// Stale: says duplicate though its only twin does not count.
		const copy = await reviewPo({
			poNumber: number,
			extra: {
				status: "BLOCKED",
				checks: [{ code: "duplicate", severity: "blocked" }],
			},
		})
		const page = (await load(copy.id)) as { po: { original: unknown } }
		expect(page.po.original).toBeNull()
	})
	it("a copy stored as a duplicate of a short twin is checked again on opening, and can go on", async () => {
		const number = poNumber()
		const short = await reviewPo({
			poNumber: number,
			extra: {
				status: "BLOCKED",
				statedPages: 2,
				checks: [{ code: "pages_missing", severity: "blocked" }],
				receivedAt: new Date(Date.now() - 60_000),
			},
		})
		// Written under the older rule, when any earlier copy counted.
		const copy = await reviewPo({
			poNumber: number,
			extra: {
				status: "BLOCKED",
				checks: [{ code: "duplicate", severity: "blocked", detail: number }],
			},
		})
		const page = (await load(copy.id)) as {
			view: string
			po: { status: string; checks: { code: string }[] }
		}
		expect(page.view).toBe("review")
		expect(codes(page.po.checks)).not.toContain("duplicate")
		expect(page.po.status).toBe("READY")
		const old = await db.claroPo.findUniqueOrThrow({ where: { id: short.id } })
		expect(old.status).toBe("SUPERSEDED")
		expect(old.supersededById).toBe(copy.id)
		const res = await post(copy.id, {
			intent: "generate",
			workMonth: "2026-08",
		})
		expect(location(res)).toBe(`/finance/claro/${copy.id}?step=generate`)
	})

	it("a rate already on the PO's lines is kept on save; a new odd rate is not", async () => {
		const odd = await reviewPo({
			extra: {
				lines: [
					{ item: "10", description: "x", amount: 100, ivuRate: 0.07, ivu: 7 },
				],
			},
		})
		const keep = (amount: number) =>
			JSON.stringify([{ item: "10", description: "x", amount, ivuRate: 0.07 }])
		// A header-only save posts the read line back unchanged.
		expect(
			await post(odd.id, {
				intent: "fix",
				...header(odd),
				termsDays: "45",
				lines: keep(100),
			}),
		).toEqual({ saved: true })
		// A line edit that leaves the read rate alone.
		expect(
			await post(odd.id, {
				intent: "fix",
				...header(odd),
				termsDays: "45",
				lines: keep(90),
			}),
		).toEqual({ saved: true })
		const row = await db.claroPo.findUniqueOrThrow({ where: { id: odd.id } })
		expect(row.termsDays).toBe(45)
		expect((row.lines as { amount: number }[])[0].amount).toBe(90)

		const plain = await reviewPo()
		const withLine = (rate: number) =>
			JSON.stringify([
				{ item: "10", description: "x", amount: 100, ivuRate: 0.115 },
				{ item: "20", description: "y", amount: 10, ivuRate: rate },
			])
		expect(
			await post(plain.id, {
				intent: "fix",
				...header(plain),
				lines: withLine(0.07),
			}),
		).toEqual({ errorKey: "claro.errors.bad_lines" })
		for (const rate of [0.04, 0.115])
			expect(
				await post(plain.id, {
					intent: "fix",
					...header(plain),
					lines: withLine(rate),
				}),
			).toEqual({ saved: true })
	})

	it("a missing PO date or PO number takes no reason: generate asks for it to be entered", async () => {
		const noDate = await reviewPo({ extra: { poDate: null } })
		const noNumber = await reviewPo({ extra: { poNumber: null } })
		for (const [po, code] of [
			[noDate, "po_date_missing"],
			[noNumber, "po_number_format"],
		] as const) {
			expect(
				await post(po.id, {
					intent: "generate",
					workMonth: "2026-08",
					[`override-${code}`]: "it is on the PO",
				}),
			).toEqual({ errorKey: "claro.errors.needs_entry" })
			expect(await db.claroInvoice.count({ where: { claroPoId: po.id } })).toBe(
				0,
			)
			const row = await db.claroPo.findUniqueOrThrow({ where: { id: po.id } })
			expect(row.status).not.toBe("CONFIRMED")
			expect(row.overrides).toBeNull()
		}
		// Entered, it goes on.
		expect(
			await post(noDate.id, {
				intent: "fix",
				...header(noDate),
				poDate: "2026-09-04",
			}),
		).toEqual({ saved: true })
		const res = await post(noDate.id, {
			intent: "generate",
			workMonth: "2026-08",
		})
		expect(location(res)).toBe(`/finance/claro/${noDate.id}?step=generate`)
	})

	it("override reasons for missing pages or a duplicate are ignored: still hard_stop, no invoice", async () => {
		const po = await reviewPo({ statedPages: 3 })
		expect(
			await post(po.id, {
				intent: "generate",
				workMonth: "2026-08",
				"override-pages_missing": "the file is complete",
				"override-duplicate": "not a duplicate",
			}),
		).toEqual({ errorKey: "claro.errors.hard_stop" })
		expect(await db.claroInvoice.count({ where: { claroPoId: po.id } })).toBe(0)
		const row = await db.claroPo.findUniqueOrThrow({ where: { id: po.id } })
		expect(row.status).toBe("BLOCKED")
		expect(row.overrides).toBeNull()
	})
})

describe("/finance/claro/:id Submit", () => {
	it("submit stamps the filed date and the due date = date + PO terms", async () => {
		const po = await reviewPo({ status: "CONFIRMED" })
		const inv = await seedInvoice(po.id, po.docId as string)
		const res = await post(po.id, { intent: "submit", loadedOn: "2026-10-01" })
		expect(location(res)).toBe(`/finance/claro?submitted=${inv.id}`)
		const row = await db.claroInvoice.findUniqueOrThrow({
			where: { id: inv.id },
		})
		expect(row.loadedAt?.toISOString()).toBe("2026-10-01T12:00:00.000Z")
		expect(row.dueDate?.toISOString()).toBe("2026-11-30T12:00:00.000Z")
	})

	it("submit refuses a date that is not a day", async () => {
		const po = await reviewPo({ status: "CONFIRMED" })
		const inv = await seedInvoice(po.id, po.docId as string)
		expect(
			await post(po.id, { intent: "submit", loadedOn: "2026-02-31" }),
		).toEqual({ errorKey: "claro.errors.bad_date" })
		expect(
			(await db.claroInvoice.findUniqueOrThrow({ where: { id: inv.id } }))
				.loadedAt,
		).toBeNull()
	})
	it("submit refuses a day after tomorrow, allows one before the invoice was made", async () => {
		const po = await reviewPo({ status: "CONFIRMED" })
		const inv = await seedInvoice(po.id, po.docId as string)
		const later = new Date(Date.now() + 3 * 86_400_000)
			.toISOString()
			.slice(0, 10)
		expect(await post(po.id, { intent: "submit", loadedOn: later })).toEqual({
			errorKey: "claro.errors.future_date",
		})
		const res = await post(po.id, { intent: "submit", loadedOn: "2020-01-02" })
		expect(location(res)).toBe(`/finance/claro?submitted=${inv.id}`)
	})
})

describe("/finance/claro/:id step guard", () => {
	it("generate or submit before an invoice exists goes back to review", async () => {
		const po = await reviewPo()
		for (const step of ["generate", "submit"])
			expect(location(await load(po.id, `?step=${step}`))).toBe(
				`/finance/claro/${po.id}?step=review`,
			)
		expect(await load(po.id)).toMatchObject({ view: "review", step: 2 })
	})

	it("opens a made invoice on submit, and a submitted one read-only or on Close", async () => {
		const po = await reviewPo({ status: "CONFIRMED" })
		const inv = await seedInvoice(po.id, po.docId as string)
		expect(await load(po.id)).toMatchObject({ view: "submit", step: 4 })
		expect(await load(po.id, "?step=generate")).toMatchObject({
			view: "generate",
		})
		await db.claroInvoice.update({
			where: { id: inv.id },
			data: { loadedAt: new Date("2026-10-01T12:00:00Z") },
		})
		expect(location(await load(po.id))).toBe("/finance/claro/close")
		expect(await load(po.id, "?step=submit")).toMatchObject({
			view: "submit",
			step: 5,
			po: { invoice: { loadedAt: "2026-10-01T12:00:00.000Z" } },
		})
	})

	it("a PO still being read shows the reading state", async () => {
		const doc = await billedDoc()
		const po = t.track(
			"claroPo",
			await db.claroPo.create({
				data: {
					filePath: "x",
					fileName: "x.pdf",
					fileHash: runToken("h"),
					status: "PENDING",
					docId: doc.id,
					uploadedById: userId,
				},
			}),
		)
		vi.mocked(kickProcessing).mockClear()
		expect(await load(po.id, "?step=review")).toMatchObject({
			view: "reading",
			step: 1,
		})
		// A read left behind by a restart is picked up again from here.
		expect(kickProcessing).toHaveBeenCalled()
		vi.mocked(kickProcessing).mockClear()
		const done = await reviewPo()
		await load(done.id)
		expect(kickProcessing).not.toHaveBeenCalled()
	})
})

describe("/finance/claro/:id roles", () => {
	it("refuses a role other than Finance or Admin", async () => {
		const po = await reviewPo()
		mocks.user.role = "INSTALLER"
		try {
			expect(location(await load(po.id))).toBe("/dashboard")
			expect(location(await post(po.id, { intent: "discard" }))).toBe(
				"/dashboard",
			)
		} finally {
			mocks.user.role = "FINANCE"
		}
	})
})

describe("/finance/claro/:id file routes", () => {
	const get = (
		fn: (args: never) => Promise<unknown>,
		id: string,
		sub: string,
	) =>
		fn({
			request: new Request(`http://localhost/finance/claro/${id}/${sub}`),
			params: { id },
			context: {},
		} as never).catch((r: unknown) => r) as Promise<Response>

	it("/file serves the PO PDF with nosniff, and refuses other roles", async () => {
		const file = path.join(dir, `${runToken("po")}.pdf`)
		await fs.writeFile(file, pdf(runToken("f")))
		const po = await reviewPo({ extra: { filePath: file } })
		const res = await get(fileLoader, po.id, "file")
		expect(res.status).toBe(200)
		expect(res.headers.get("Content-Type")).toBe("application/pdf")
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
		mocks.user.role = "INSTALLER"
		try {
			expect(location(await get(fileLoader, po.id, "file"))).toBe("/dashboard")
		} finally {
			mocks.user.role = "FINANCE"
		}
	})

	it("/invoice serves the PO's invoice PDF with nosniff, and refuses other roles", async () => {
		const file = path.join(dir, `${runToken("inv")}.pdf`)
		await fs.writeFile(file, pdf(runToken("i")))
		const po = await reviewPo({ status: "CONFIRMED" })
		const inv = await seedInvoice(po.id, po.docId as string)
		await db.claroInvoice.update({
			where: { id: inv.id },
			data: { filePath: file },
		})
		const res = await get(invoiceLoader, po.id, "invoice")
		expect(res.status).toBe(200)
		expect(res.headers.get("Content-Type")).toBe("application/pdf")
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
		mocks.user.role = "INSTALLER"
		try {
			expect(location(await get(invoiceLoader, po.id, "invoice"))).toBe(
				"/dashboard",
			)
		} finally {
			mocks.user.role = "FINANCE"
		}
	})
})
