import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import {
	confirmAllGreen,
	confirmPo,
	discardPo,
	fixPo,
	ingestPoFiles,
	PoError,
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

const t = makeTracker()
let uploadDir: string
const prevDir = process.env.UPLOAD_DIR

beforeAll(async () => {
	uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "po-inbox-"))
	process.env.UPLOAD_DIR = uploadDir
})
afterAll(async () => {
	await t.cleanup()
	process.env.UPLOAD_DIR = prevDir
	await fs.rm(uploadDir, { recursive: true, force: true })
})

/** A one-page PDF whose bytes differ per tag, so each has its own hash. */
function pdf(tag: string, pages = 1): Uint8Array {
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

const read = (over: Partial<PoRead> = {}): PoRead => ({
	poNumber: String(4500000000 + Math.floor(Math.random() * 99999999)),
	poDate: "2026-09-04",
	statedPages: 1,
	termsDays: 60,
	avisoCandidates: [],
	lines: [
		{ item: "10", description: "x", amount: 100, ivuRate: 0.115, ivu: 11.5 },
	],
	subtotal: 100,
	ivu4: 0,
	ivu115: 11.5,
	total: 111.5,
	...over,
})
const readerOf =
	(by: Record<string, PoRead>): PoReader =>
	async (bytes) => {
		const tag = /% (\S+)/.exec(Buffer.from(bytes).toString())?.[1] ?? ""
		const r = by[tag]
		if (!r) throw new Error("boom")
		return r
	}

async function setup() {
	const user = t.track("user", await seedUser({ role: "FINANCE" }))
	const avisoNumber = String(10000000 + Math.floor(Math.random() * 89999999))
	const doc = t.track(
		"jafInvoice",
		await seedFinanceableInvoice({
			avisoNumber,
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
	return { user, avisoNumber, doc }
}

describe("PO inbox", () => {
	it("same bytes twice in one batch: one row, the same id returned twice", async () => {
		const { user } = await setup()
		const tag = runToken("dup")
		const f = { name: `${tag}.pdf`, bytes: pdf(tag) }
		const ids = await ingestPoFiles([f, f], user.id)
		t.track("claroPo", { id: ids[0] })
		expect(ids[1]).toBe(ids[0])
		expect(await db.claroPo.count({ where: { fileName: f.name } })).toBe(1)
	})

	it("same bytes again after the first was read creates no new row", async () => {
		const { user } = await setup()
		const tag = runToken("again")
		const f = { name: `${tag}.pdf`, bytes: pdf(tag) }
		const [first] = await ingestPoFiles([f], user.id)
		t.track("claroPo", { id: first })
		await processPending(readerOf({ [tag]: read() }), 1)
		const [second] = await ingestPoFiles([f], user.id)
		expect(second).toBe(first)
		expect(await db.claroPo.count({ where: { fileName: f.name } })).toBe(1)
	})

	it("a SUPERSEDED row with the same hash does not block a new upload", async () => {
		const { user } = await setup()
		const tag = runToken("sup")
		const f = { name: `${tag}.pdf`, bytes: pdf(tag) }
		const [first] = await ingestPoFiles([f], user.id)
		t.track("claroPo", { id: first })
		await db.claroPo.update({
			where: { id: first },
			data: { status: "SUPERSEDED" },
		})
		const [second] = await ingestPoFiles([f], user.id)
		t.track("claroPo", { id: second })
		expect(second).not.toBe(first)
	})

	it("rejects a non-PDF", async () => {
		const { user } = await setup()
		await expect(
			ingestPoFiles(
				[{ name: "x.pdf", bytes: new TextEncoder().encode("hello") }],
				user.id,
			),
		).rejects.toMatchObject({ code: "not_pdf" })
	})

	it("reads queued POs, matches the Aviso and sorts green from the rest", async () => {
		const { user, avisoNumber, doc } = await setup()
		const tagA = runToken("a")
		const tagB = runToken("b")
		const tagC = runToken("c")
		const ids = await ingestPoFiles(
			[tagA, tagB, tagC].map((tag) => ({
				name: `${tag}.pdf`,
				bytes: pdf(tag),
			})),
			user.id,
		)
		for (const id of ids) t.track("claroPo", { id })
		const okRead = read({ avisoCandidates: [avisoNumber] })
		const badSum = read({ avisoCandidates: [avisoNumber], subtotal: 90 })
		const noAviso = read({ avisoCandidates: ["99999999"] })
		await processPending(
			readerOf({ [tagA]: okRead, [tagB]: badSum, [tagC]: noAviso }),
			2,
		)
		const rows = await db.claroPo.findMany({ where: { id: { in: ids } } })
		const by = (i: number) => rows.find((r) => r.id === ids[i])
		expect(by(0)?.status).toBe("READY")
		expect(by(0)?.docId).toBe(doc.id)
		expect(by(1)?.status).toBe("NEEDS_LOOK")
		expect(by(2)?.status).toBe("UNMATCHED")
		expect(by(0)?.filePages).toBe(1)
	})

	it("parks a PO the reader fails on as Needs a look instead of losing it", async () => {
		const { user } = await setup()
		const tag = runToken("fail")
		const [id] = await ingestPoFiles(
			[{ name: "f.pdf", bytes: pdf(tag) }],
			user.id,
		)
		t.track("claroPo", { id })
		await processPending(readerOf({}), 1)
		const row = await db.claroPo.findUniqueOrThrow({ where: { id } })
		expect(row.status).toBe("NEEDS_LOOK")
		expect(row.readError).toBe("boom")
	})

	it("blocks a PO whose file has fewer pages than it states", async () => {
		const { user, avisoNumber } = await setup()
		const tag = runToken("pg")
		const [id] = await ingestPoFiles(
			[{ name: "p.pdf", bytes: pdf(tag) }],
			user.id,
		)
		t.track("claroPo", { id })
		await processPending(
			readerOf({
				[tag]: read({ avisoCandidates: [avisoNumber], statedPages: 4 }),
			}),
			1,
		)
		expect((await db.claroPo.findUniqueOrThrow({ where: { id } })).status).toBe(
			"BLOCKED",
		)
	})

	it("confirm saves the PO under its Aviso, stamps it, and refuses a second confirm", async () => {
		const { user, avisoNumber, doc } = await setup()
		const tag = runToken("cf")
		const [id] = await ingestPoFiles(
			[{ name: "c.pdf", bytes: pdf(tag) }],
			user.id,
		)
		t.track("claroPo", { id })
		const r = read({ avisoCandidates: [avisoNumber] })
		await processPending(readerOf({ [tag]: r }), 1)
		await confirmPo(id, user.id)
		const row = await db.claroPo.findUniqueOrThrow({ where: { id } })
		expect(row.status).toBe("CONFIRMED")
		expect(row.confirmedById).toBe(user.id)
		expect(row.poDate?.toISOString().slice(0, 10)).toBe("2026-09-04")
		const trail = await db.auditTrail.findFirst({
			where: { docId: doc.id, action: "PO_CONFIRMED" },
		})
		expect((trail?.diffJson as { source: string }).source).toBe("STAMPED")
		expect(await db.poLink.count({ where: { docId: doc.id } })).toBe(1)
		await expect(confirmPo(id, user.id)).rejects.toMatchObject({
			code: "already_confirmed",
		})
	})

	it("a second copy of a confirmed PO number is blocked as a duplicate", async () => {
		const { user, avisoNumber } = await setup()
		const number = String(4600000000 + Math.floor(Math.random() * 99999999))
		const tagA = runToken("d1")
		const tagB = runToken("d2")
		const [a, b] = await ingestPoFiles(
			[tagA, tagB].map((tag) => ({ name: `${tag}.pdf`, bytes: pdf(tag) })),
			user.id,
		)
		t.track("claroPo", { id: a })
		t.track("claroPo", { id: b })
		const same = read({ avisoCandidates: [avisoNumber], poNumber: number })
		await processPending(readerOf({ [tagA]: same, [tagB]: same }), 1)
		const first = await db.claroPo.findMany({ where: { id: { in: [a, b] } } })
		// Oldest upload wins; the other is the duplicate.
		expect(first.filter((r) => r.status === "BLOCKED")).toHaveLength(1)
		const winner = first.find((r) => r.status === "READY")
		expect(winner).toBeDefined()
		await confirmPo(winner!.id, user.id)
	})

	it("confirm-all-green confirms only green rows", async () => {
		const { user, avisoNumber } = await setup()
		const tagG = runToken("g")
		const tagR = runToken("r")
		const [g, r] = await ingestPoFiles(
			[tagG, tagR].map((tag) => ({ name: `${tag}.pdf`, bytes: pdf(tag) })),
			user.id,
		)
		t.track("claroPo", { id: g })
		t.track("claroPo", { id: r })
		await processPending(
			readerOf({
				[tagG]: read({ avisoCandidates: [avisoNumber] }),
				[tagR]: read({ avisoCandidates: [avisoNumber], subtotal: 1 }),
			}),
			1,
		)
		const { confirmed } = await confirmAllGreen(user.id)
		expect(confirmed).toBeGreaterThanOrEqual(1)
		expect(
			(await db.claroPo.findUniqueOrThrow({ where: { id: g } })).status,
		).toBe("CONFIRMED")
		expect(
			(await db.claroPo.findUniqueOrThrow({ where: { id: r } })).status,
		).toBe("NEEDS_LOOK")
	})

	it("fixing a field re-runs the checks and remembers who entered it", async () => {
		const { user, avisoNumber } = await setup()
		const tag = runToken("fx")
		const [id] = await ingestPoFiles(
			[{ name: "x.pdf", bytes: pdf(tag) }],
			user.id,
		)
		t.track("claroPo", { id })
		await processPending(
			readerOf({
				[tag]: read({ avisoCandidates: [avisoNumber], poNumber: "123" }),
			}),
			1,
		)
		expect((await db.claroPo.findUniqueOrThrow({ where: { id } })).status).toBe(
			"NEEDS_LOOK",
		)
		await fixPo(id, user.id, { poNumber: "4500123456" })
		const row = await db.claroPo.findUniqueOrThrow({ where: { id } })
		expect(row.status).toBe("READY")
		expect(
			(row.entered as Record<string, { byId: string }>).poNumber.byId,
		).toBe(user.id)
	})

	it("an unmatched PO is linked by typing its Aviso number", async () => {
		const { user, avisoNumber, doc } = await setup()
		const tag = runToken("lk")
		const [id] = await ingestPoFiles(
			[{ name: "l.pdf", bytes: pdf(tag) }],
			user.id,
		)
		t.track("claroPo", { id })
		await processPending(readerOf({ [tag]: read() }), 1)
		expect((await db.claroPo.findUniqueOrThrow({ where: { id } })).status).toBe(
			"UNMATCHED",
		)
		await expect(
			fixPo(id, user.id, { avisoNumber: "00000000" }),
		).rejects.toBeInstanceOf(PoError)
		await fixPo(id, user.id, { avisoNumber })
		const row = await db.claroPo.findUniqueOrThrow({ where: { id } })
		expect(row.docId).toBe(doc.id)
		expect(row.status).toBe("READY")
	})

	it("fixPo with lines recomputes totals", async () => {
		const { user, avisoNumber } = await setup()
		const tag = runToken("ln")
		const [id] = await ingestPoFiles(
			[{ name: "l.pdf", bytes: pdf(tag) }],
			user.id,
		)
		t.track("claroPo", { id })
		await processPending(
			readerOf({ [tag]: read({ avisoCandidates: [avisoNumber] }) }),
			1,
		)
		await fixPo(id, user.id, {
			lines: [
				{ item: "10", description: "a", amount: 100, ivuRate: 0.04 },
				{ item: "20", description: "b", amount: 200, ivuRate: 0.115 },
			],
		})
		const row = await db.claroPo.findUniqueOrThrow({ where: { id } })
		expect(Number(row.subtotal)).toBe(300)
		expect(Number(row.ivu4)).toBe(4)
		expect(Number(row.ivu115)).toBe(23)
		expect(Number(row.total)).toBe(327)
		expect((row.lines as { ivu: number }[]).map((l) => l.ivu)).toEqual([4, 23])
		// What the PO printed is kept, so the edited lines are checked against it.
		expect(row.printed).toEqual({
			subtotal: 100,
			ivu4: 0,
			ivu115: 11.5,
			total: 111.5,
		})
		expect((row.checks as { code: string }[]).map((c) => c.code)).toContain(
			"lines_sum",
		)
		expect((row.entered as Record<string, { byId: string }>).lines.byId).toBe(
			user.id,
		)
	})

	it("a line reading 0.00 can be corrected in place", async () => {
		const { user, avisoNumber } = await setup()
		const tag = runToken("z")
		const [id] = await ingestPoFiles(
			[{ name: "z.pdf", bytes: pdf(tag) }],
			user.id,
		)
		t.track("claroPo", { id })
		await processPending(
			readerOf({
				[tag]: read({
					avisoCandidates: [avisoNumber],
					lines: [
						{ item: "10", description: "x", amount: 0, ivuRate: 0.115, ivu: 0 },
					],
				}),
			}),
			1,
		)
		// A row read before only missing pages and duplicates hard-stopped.
		await db.claroPo.update({ where: { id }, data: { status: "BLOCKED" } })
		await fixPo(id, user.id, {
			lines: [{ item: "10", description: "x", amount: 100, ivuRate: 0.115 }],
		})
		const row = await db.claroPo.findUniqueOrThrow({ where: { id } })
		expect(row.status).not.toBe("BLOCKED")
		expect(row.status).toBe("READY")
	})

	it("complete re-upload supersedes a missing-pages PO", async () => {
		const { user, avisoNumber } = await setup()
		const number = String(4700000000 + Math.floor(Math.random() * 99999999))
		const tagA = runToken("short")
		const [a] = await ingestPoFiles(
			[{ name: "a.pdf", bytes: pdf(tagA, 1) }],
			user.id,
		)
		t.track("claroPo", { id: a })
		const r = read({
			avisoCandidates: [avisoNumber],
			poNumber: number,
			statedPages: 2,
		})
		await processPending(readerOf({ [tagA]: r }), 1)
		expect(
			(await db.claroPo.findUniqueOrThrow({ where: { id: a } })).status,
		).toBe("BLOCKED")
		const tagB = runToken("full")
		const [b] = await ingestPoFiles(
			[{ name: "b.pdf", bytes: pdf(tagB, 2) }],
			user.id,
		)
		t.track("claroPo", { id: b })
		await processPending(readerOf({ [tagB]: r }), 1)
		const old = await db.claroPo.findUniqueOrThrow({ where: { id: a } })
		expect(old.status).toBe("SUPERSEDED")
		expect(old.supersededById).toBe(b)
		const fresh = await db.claroPo.findUniqueOrThrow({ where: { id: b } })
		expect(
			(fresh.checks as { code: string }[]).map((c) => c.code),
		).not.toContain("duplicate")
		expect(fresh.status).toBe("READY")
	})

	it("a short copy read after its complete twin is superseded by it", async () => {
		const { user, avisoNumber } = await setup()
		const number = String(4800000000 + Math.floor(Math.random() * 99999999))
		const r = read({
			avisoCandidates: [avisoNumber],
			poNumber: number,
			statedPages: 2,
		})
		const tagB = runToken("full2")
		const [b] = await ingestPoFiles(
			[{ name: "b.pdf", bytes: pdf(tagB, 2) }],
			user.id,
		)
		t.track("claroPo", { id: b })
		await processPending(readerOf({ [tagB]: r }), 1)
		const tagA = runToken("short2")
		const [a] = await ingestPoFiles(
			[{ name: "a.pdf", bytes: pdf(tagA, 1) }],
			user.id,
		)
		t.track("claroPo", { id: a })
		await processPending(readerOf({ [tagA]: r }), 1)
		const short = await db.claroPo.findUniqueOrThrow({ where: { id: a } })
		expect(short.status).toBe("SUPERSEDED")
		expect(short.supersededById).toBe(b)
		expect(
			(await db.claroPo.findUniqueOrThrow({ where: { id: b } })).status,
		).toBe("READY")
	})

	it("second identical upload after confirm is a duplicate", async () => {
		const { user, avisoNumber } = await setup()
		// A different file (own hash) of the same PO number: the number alone decides.
		const tagA = runToken("same1")
		const tagB = runToken("same2")
		const [a] = await ingestPoFiles(
			[{ name: "a.pdf", bytes: pdf(tagA) }],
			user.id,
		)
		t.track("claroPo", { id: a })
		const r = read({ avisoCandidates: [avisoNumber] })
		await processPending(readerOf({ [tagA]: r }), 1)
		await confirmPo(a, user.id)
		const [b] = await ingestPoFiles(
			[{ name: "a.pdf", bytes: pdf(tagB) }],
			user.id,
		)
		t.track("claroPo", { id: b })
		await processPending(readerOf({ [tagB]: r }), 1)
		const row = await db.claroPo.findUniqueOrThrow({ where: { id: b } })
		expect(row.fileHash).not.toBe(
			(await db.claroPo.findUniqueOrThrow({ where: { id: a } })).fileHash,
		)
		expect(row.status).toBe("BLOCKED")
		expect((row.checks as { code: string }[]).map((c) => c.code)).toContain(
			"duplicate",
		)
	})

	it("a twin that already has an invoice stays a duplicate", async () => {
		const { user, avisoNumber, doc } = await setup()
		const number = String(4900000000 + Math.floor(Math.random() * 99999999))
		// An older copy stuck on missing pages, yet invoiced (an old M19 added by hand).
		const old = await db.claroPo.create({
			data: {
				poNumber: number,
				statedPages: 2,
				filePages: 1,
				filePath: "x",
				fileName: "x.pdf",
				fileHash: runToken("h"),
				status: "BLOCKED",
				checks: [{ code: "pages_missing", severity: "blocked" }],
				docId: doc.id,
				uploadedById: user.id,
				receivedAt: new Date(Date.now() - 60_000),
			},
		})
		t.track("claroPo", old)
		await db.claroInvoice.create({
			data: {
				series: "M19",
				seq: 8_400_000 + Math.floor(Math.random() * 900_000),
				claroPoId: old.id,
				docId: doc.id,
				workMonth: "",
				subtotal: 100,
				ivu4: 0,
				ivu115: 11.5,
				total: 111.5,
				madeById: user.id,
			},
		})
		const tag = runToken("inv")
		const [b] = await ingestPoFiles(
			[{ name: "b.pdf", bytes: pdf(tag, 2) }],
			user.id,
		)
		t.track("claroPo", { id: b })
		await processPending(
			readerOf({
				[tag]: read({
					avisoCandidates: [avisoNumber],
					poNumber: number,
					statedPages: 2,
				}),
			}),
			1,
		)
		const row = await db.claroPo.findUniqueOrThrow({ where: { id: b } })
		expect((row.checks as { code: string }[]).map((c) => c.code)).toContain(
			"duplicate",
		)
		expect(row.status).toBe("BLOCKED")
		expect(
			(await db.claroPo.findUniqueOrThrow({ where: { id: old.id } })).status,
		).toBe("BLOCKED")
	})

	it("a hand-typed PO number does not supersede a short PO", async () => {
		const { user, avisoNumber } = await setup()
		const number = String(4910000000 + Math.floor(Math.random() * 99999999))
		const tagS = runToken("hs")
		const [short] = await ingestPoFiles(
			[{ name: "s.pdf", bytes: pdf(tagS, 1) }],
			user.id,
		)
		t.track("claroPo", { id: short })
		await processPending(
			readerOf({
				[tagS]: read({
					avisoCandidates: [avisoNumber],
					poNumber: number,
					statedPages: 2,
				}),
			}),
			1,
		)
		const tagC = runToken("hc")
		const [complete] = await ingestPoFiles(
			[{ name: "c.pdf", bytes: pdf(tagC, 1) }],
			user.id,
		)
		t.track("claroPo", { id: complete })
		await processPending(
			readerOf({
				[tagC]: read({ avisoCandidates: [avisoNumber], poNumber: "123" }),
			}),
			1,
		)
		await fixPo(complete, user.id, { poNumber: number })
		const s = await db.claroPo.findUniqueOrThrow({ where: { id: short } })
		expect(s.status).toBe("BLOCKED")
		expect(s.supersededById).toBeNull()
	})

	it("a header typed by hand is what the PO printed: lines that disagree stay red", async () => {
		const { user, avisoNumber } = await setup()
		const tag = runToken("hd")
		const [id] = await ingestPoFiles(
			[{ name: "h.pdf", bytes: pdf(tag) }],
			user.id,
		)
		t.track("claroPo", { id })
		await processPending(
			readerOf({ [tag]: read({ avisoCandidates: [avisoNumber] }) }),
			1,
		)
		await fixPo(id, user.id, { subtotal: 10, ivu115: 1.15, total: 11.15 })
		const row = await db.claroPo.findUniqueOrThrow({ where: { id } })
		expect(row.printed).toEqual({
			subtotal: 10,
			ivu4: 0,
			ivu115: 1.15,
			total: 11.15,
		})
		const codes = (row.checks as { code: string }[]).map((c) => c.code)
		expect(codes).toContain("lines_sum")
		expect(codes).toContain("totals")
		expect(row.status).toBe("NEEDS_LOOK")
	})

	it("correcting a misread printed subtotal turns the checks green", async () => {
		const { user, avisoNumber } = await setup()
		const tag = runToken("mr")
		const [id] = await ingestPoFiles(
			[{ name: "m.pdf", bytes: pdf(tag) }],
			user.id,
		)
		t.track("claroPo", { id })
		await processPending(
			readerOf({
				[tag]: read({ avisoCandidates: [avisoNumber], subtotal: 90 }),
			}),
			1,
		)
		expect((await db.claroPo.findUniqueOrThrow({ where: { id } })).status).toBe(
			"NEEDS_LOOK",
		)
		await fixPo(id, user.id, { subtotal: 100 })
		const row = await db.claroPo.findUniqueOrThrow({ where: { id } })
		expect(row.checks).toEqual([])
		expect(row.status).toBe("READY")
	})

	it("a row with no printed value is checked against its header before the first line edit", async () => {
		const { user, doc } = await setup()
		const legacy = await db.claroPo.create({
			data: {
				poNumber: String(4920000000 + Math.floor(Math.random() * 99999999)),
				poDate: new Date("2026-09-04T12:00:00Z"),
				termsDays: 60,
				statedPages: 1,
				filePages: 1,
				filePath: "x",
				fileName: "x.pdf",
				fileHash: runToken("h"),
				status: "READY",
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
				uploadedById: user.id,
			},
		})
		t.track("claroPo", legacy)
		await fixPo(legacy.id, user.id, {
			lines: [{ item: "10", description: "x", amount: 200, ivuRate: 0.115 }],
		})
		const row = await db.claroPo.findUniqueOrThrow({ where: { id: legacy.id } })
		expect(row.printed).toEqual({
			subtotal: 100,
			ivu4: 0,
			ivu115: 11.5,
			total: 111.5,
		})
		expect(Number(row.total)).toBe(223)
		expect((row.checks as { code: string }[]).map((c) => c.code)).toContain(
			"lines_sum",
		)
	})

	it("discardPo retires a duplicate copy under the confirmed original, audited", async () => {
		const { user, avisoNumber, doc } = await setup()
		const number = String(4920000000 + Math.floor(Math.random() * 99999999))
		const tagA = runToken("orig")
		const tagB = runToken("copy")
		const [a] = await ingestPoFiles(
			[{ name: "a.pdf", bytes: pdf(tagA) }],
			user.id,
		)
		t.track("claroPo", { id: a })
		const r = read({ avisoCandidates: [avisoNumber], poNumber: number })
		await processPending(readerOf({ [tagA]: r }), 1)
		await confirmPo(a, user.id)
		const [b] = await ingestPoFiles(
			[{ name: "b.pdf", bytes: pdf(tagB) }],
			user.id,
		)
		t.track("claroPo", { id: b })
		await processPending(readerOf({ [tagB]: r }), 1)
		await discardPo(b, user.id)
		const row = await db.claroPo.findUniqueOrThrow({ where: { id: b } })
		expect(row.status).toBe("SUPERSEDED")
		expect(row.supersededById).toBe(a)
		expect(
			await db.auditTrail.count({
				where: { docId: doc.id, action: "PO_DISCARDED", userId: user.id },
			}),
		).toBe(1)
	})

	it("discardPo refuses a PO that is not a duplicate", async () => {
		const { user, avisoNumber } = await setup()
		const tag = runToken("lone")
		const [a] = await ingestPoFiles(
			[{ name: "a.pdf", bytes: pdf(tag) }],
			user.id,
		)
		t.track("claroPo", { id: a })
		await processPending(
			readerOf({
				[tag]: read({ avisoCandidates: [avisoNumber], termsDays: null }),
			}),
			1,
		)
		await expect(discardPo(a, user.id)).rejects.toMatchObject({
			code: "not_discardable",
		})
		const row = await db.claroPo.findUniqueOrThrow({ where: { id: a } })
		expect(row.status).toBe("NEEDS_LOOK")
		expect(row.supersededById).toBeNull()
	})
})
