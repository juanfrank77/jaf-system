import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import {
	confirmAllGreen,
	confirmPo,
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
		expect(by(1)?.status).toBe("BLOCKED")
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
		).toBe("BLOCKED")
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
})
