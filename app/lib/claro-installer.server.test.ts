import fs from "node:fs/promises"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { loadComptrollerHome } from "~/lib/comptroller-home.server"
import { db } from "~/lib/db.server"
import { makeTracker, runToken, seedUser } from "~/test/helpers"
import {
	addPo,
	CLARO_OPEN,
	claroRowView,
	claroStage,
	expectedClaroTotal,
	isClaroOverdue,
	loadClaroInvoiceRows,
	markAribaSent,
} from "./claro-installer.server"

const t = makeTracker()
let carmen: Awaited<ReturnType<typeof seedUser>>
let uploadDir: string
const prevUploadDir = process.env.UPLOAD_DIR

beforeAll(async () => {
	uploadDir = await fs.mkdtemp("/tmp/claro-inst-test-")
	process.env.UPLOAD_DIR = uploadDir
	carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
})
afterAll(async () => {
	await t.cleanup()
	if (prevUploadDir === undefined) delete process.env.UPLOAD_DIR
	else process.env.UPLOAD_DIR = prevUploadDir
	await fs.rm(uploadDir, { recursive: true, force: true })
})

const mk = async (over: Record<string, unknown> = {}) => {
	const inv = await db.ewitInvoice.create({
		data: {
			number: runToken("JA"),
			invoiceDate: new Date(),
			total: 4871.55,
			filePath: "/files/x.pdf",
			createdById: carmen.id,
			...over,
		} as never,
	})
	t.track("ewitInvoice", { id: inv.id })
	return inv
}
const po = (invoiceId: string, over: Record<string, unknown> = {}) => ({
	invoiceId,
	poNumber: "4500123456",
	poDate: new Date(),
	poFile: { name: "po.pdf", bytes: new Uint8Array([37, 80, 68, 70]) },
	reprintTotal: 5066.41,
	userId: carmen.id,
	...over,
})
const code = (p: Promise<unknown>) =>
	p.then(
		() => "ok",
		(e) => (e as { code?: string }).code,
	)

describe("addPo", () => {
	it("stores PO, IVU and Claro total", async () => {
		const inv = await mk()
		await addPo(po(inv.id))
		const r = await db.ewitInvoice.findUniqueOrThrow({ where: { id: inv.id } })
		expect(r.poNumber).toBe("4500123456")
		expect(r.poFilePath).toBeTruthy()
		expect(Number(r.ivuAmount)).toBe(194.86)
		expect(Number(r.claroTotal)).toBe(5066.41)
		expect(claroStage(r)).toBe("ready_for_ariba")
	})
	it("rejects a mismatched reprint total and writes nothing", async () => {
		const inv = await mk()
		expect(await code(addPo(po(inv.id, { reprintTotal: 5000 })))).toBe(
			"po_total_mismatch",
		)
		const r = await db.ewitInvoice.findUniqueOrThrow({ where: { id: inv.id } })
		expect(r.poNumber).toBeNull()
		expect(r.claroTotal).toBeNull()
	})
	it("rejects voided and held invoices", async () => {
		const v = await mk({ voidedAt: new Date() })
		expect(await code(addPo(po(v.id)))).toBe("voided")
		const h = await mk({ heldAt: new Date() })
		expect(await code(addPo(po(h.id)))).toBe("voided")
	})
	it("rounds half-cent ties up (1.10 at 5% -> 0.06)", async () => {
		const inv = await mk({ total: 1.1 })
		await addPo(po(inv.id, { ivuRate: 0.05, reprintTotal: 1.16 }))
		const r = await db.ewitInvoice.findUniqueOrThrow({ where: { id: inv.id } })
		expect(Number(r.ivuAmount)).toBe(0.06)
		expect(Number(r.claroTotal)).toBe(1.16)
	})
	it("uses a custom ivuRate", async () => {
		const inv = await mk({ total: 100 })
		await addPo(po(inv.id, { ivuRate: 0.115, reprintTotal: 111.5 }))
		const r = await db.ewitInvoice.findUniqueOrThrow({ where: { id: inv.id } })
		expect(Number(r.ivuAmount)).toBe(11.5)
		expect(Number(r.ivuRate)).toBe(0.115)
	})
	it("saves no file on mismatch", async () => {
		const inv = await mk()
		await code(addPo(po(inv.id, { reprintTotal: 5000 })))
		const dir = `${uploadDir}/ewit-po`
		const files = await fs.readdir(dir).catch(() => [] as string[])
		expect(files.some((f) => f.includes(inv.number))).toBe(false)
	})
	it("refuses a sent or paid invoice and changes nothing", async () => {
		const sent = await mk({
			poNumber: "OLD",
			claroTotal: 5066.41,
			aribaSentAt: new Date(),
		})
		expect(await code(addPo(po(sent.id)))).toBe("already_sent")
		const paid = await mk({ poNumber: "OLD", claroPaidAt: new Date() })
		expect(await code(addPo(po(paid.id)))).toBe("already_sent")
		for (const i of [sent, paid]) {
			const r = await db.ewitInvoice.findUniqueOrThrow({ where: { id: i.id } })
			expect(r.poNumber).toBe("OLD")
			expect(r.ivuAmount).toBeNull()
		}
		expect(
			Number(
				(await db.ewitInvoice.findUniqueOrThrow({ where: { id: sent.id } }))
					.claroTotal,
			),
		).toBe(5066.41)
	})
	it("not_found for unknown id", async () => {
		expect(await code(addPo(po("nope")))).toBe("not_found")
	})
})

describe("markAribaSent", () => {
	it("refuses before a PO, then marks once", async () => {
		const inv = await mk()
		const args = { invoiceIds: [inv.id], sentOn: new Date(), userId: carmen.id }
		expect(await code(markAribaSent(args))).toBe("no_po")
		await addPo(po(inv.id))
		await markAribaSent(args)
		const r = await db.ewitInvoice.findUniqueOrThrow({ where: { id: inv.id } })
		expect(r.aribaSentById).toBe(carmen.id)
		expect(claroStage(r)).toBe("sent")
		expect(await code(markAribaSent(args))).toBe("already_sent")
	})
})

describe("markAribaSent edge cases", () => {
	it("is atomic: one already-sent row leaves the valid one unsent", async () => {
		const good = await mk({ poNumber: "P1" })
		const sent = await mk({ poNumber: "P2", aribaSentAt: new Date() })
		expect(
			await code(
				markAribaSent({
					invoiceIds: [good.id, sent.id],
					sentOn: new Date(),
					userId: carmen.id,
				}),
			),
		).toBe("already_sent")
		const r = await db.ewitInvoice.findUniqueOrThrow({ where: { id: good.id } })
		expect(r.aribaSentAt).toBeNull()
	})
	it("not_found and voided", async () => {
		const args = { sentOn: new Date(), userId: carmen.id }
		expect(await code(markAribaSent({ ...args, invoiceIds: ["nope"] }))).toBe(
			"not_found",
		)
		const v = await mk({ poNumber: "P3", voidedAt: new Date() })
		expect(await code(markAribaSent({ ...args, invoiceIds: [v.id] }))).toBe(
			"voided",
		)
	})
})

describe("claroStage", () => {
	const base = {
		poNumber: "1",
		aribaSentAt: null,
		claroPaidAt: null,
		claroPaidNet: null,
		claroTotal: 100,
		shortAcceptedAt: null,
	}
	it("walks the stages", () => {
		expect(claroStage({ ...base, poNumber: null })).toBe("no_po")
		expect(claroStage(base)).toBe("ready_for_ariba")
		expect(claroStage({ ...base, aribaSentAt: new Date() })).toBe("sent")
		const paid = { ...base, aribaSentAt: new Date(), claroPaidAt: new Date() }
		expect(claroStage({ ...paid, claroPaidNet: 100 })).toBe("paid")
		expect(claroStage({ ...paid, claroPaidNet: 90 })).toBe("short")
		expect(
			claroStage({ ...paid, claroPaidNet: 90, shortAcceptedAt: new Date() }),
		).toBe("paid")
	})
})

describe("expectedClaroTotal / isClaroOverdue", () => {
	it("adds 4% IVU in cents", () => {
		expect(expectedClaroTotal(4871.55)).toBe(5066.41)
		expect(expectedClaroTotal(100, 0.115)).toBe(111.5)
	})
	it("flags Ariba sends more than 60 days old", () => {
		const now = new Date("2026-10-28T12:00:00Z")
		const ago = (d: number) => new Date(now.getTime() - d * 86400000)
		expect(isClaroOverdue(ago(61), now)).toBe(true)
		expect(isClaroOverdue(ago(59), now)).toBe(false)
		expect(isClaroOverdue(null, now)).toBe(false)
		// exactly 60 days is not yet over; a minute more is
		expect(isClaroOverdue(ago(60), now)).toBe(false)
		expect(isClaroOverdue(new Date(ago(60).getTime() - 60000), now)).toBe(true)
	})
})

describe("claroRowView", () => {
	const now = new Date("2026-10-28T12:00:00Z")
	const day = 86400000
	const base = {
		id: "i",
		number: "JA1",
		invoiceDate: new Date("2026-09-01T12:00:00Z"),
		total: 4871.55,
		poNumber: null as string | null,
		aribaSentAt: null as Date | null,
		claroPaidAt: null as Date | null,
		claroPaidNet: null as number | null,
		claroTotal: null as number | null,
		shortAcceptedAt: null,
		batch: { sentAt: new Date(now.getTime() - 12 * day - 5000) },
	}
	it("groups each stage and reports days waiting, amber and shortfall", () => {
		const noPo = claroRowView(base, now)
		expect(noPo.stage).toBe("no_po")
		expect(noPo.daysWaiting).toBe(12)
		expect(noPo.expected).toBe(5066.41)
		const ready = { ...base, poNumber: "P", claroTotal: 5066.41 }
		expect(claroRowView(ready, now).stage).toBe("ready_for_ariba")
		const sent = (d: number) => ({
			...ready,
			aribaSentAt: new Date(now.getTime() - d * day),
		})
		expect(claroRowView(sent(61), now)).toMatchObject({
			stage: "sent",
			overdue: true,
		})
		expect(claroRowView(sent(59), now).overdue).toBe(false)
		const paid = { ...sent(10), claroPaidAt: now, claroPaidNet: 5066.41 }
		expect(claroRowView(paid, now)).toMatchObject({
			stage: "paid",
			overdue: false,
		})
		const short = { ...paid, claroPaidNet: 5000 }
		expect(claroRowView(short, now)).toMatchObject({
			stage: "short",
			shortBy: 66.41,
		})
	})
})

describe("loadClaroInvoiceRows (Claro invoices page)", () => {
	const sentBatch = async () => {
		const b = await db.ewitBatch.create({
			data: {
				createdById: carmen.id,
				sentAt: new Date(),
				closedAt: new Date(),
			},
		})
		t.track("ewitBatch", { id: b.id })
		return b
	}
	const paidOn = (day: string) => ({
		poNumber: "PO-P",
		claroTotal: 100,
		aribaSentAt: new Date("2026-09-01T12:00:00Z"),
		claroPaidAt: new Date(`${day}T12:00:00Z`),
		claroPaidNet: 100,
	})

	it("lists every open invoice, newest included, and only the most recent paid ones", async () => {
		const b = await sentBatch()
		// Paid in full on days later than anything else in the shared database.
		const p1 = await mk({ batchId: b.id, ...paidOn("2099-01-01") })
		const p2 = await mk({ batchId: b.id, ...paidOn("2099-01-02") })
		const p3 = await mk({ batchId: b.id, ...paidOn("2099-01-03") })
		const accepted = await mk({
			batchId: b.id,
			...paidOn("2099-01-04"),
			claroPaidNet: 90,
			shortAcceptedAt: new Date(),
		})
		const newest = await mk({
			batchId: b.id,
			invoiceDate: new Date("2099-06-01T12:00:00Z"),
		})
		const now = new Date()

		const all = await loadClaroInvoiceRows(null, now, 2)
		const ids = all.map((r) => r.id)
		expect(ids).toContain(newest.id)
		// The two most recent paid ones, most recent first; older paid are left out.
		const paid = all.filter((r) => r.stage === "paid").map((r) => r.id)
		expect(paid).toEqual([accepted.id, p3.id])
		expect(ids).not.toContain(p2.id)
		expect(ids).not.toContain(p1.id)

		const noPo = await loadClaroInvoiceRows("no_po", now, 2)
		expect(noPo.map((r) => r.id)).toContain(newest.id)
		expect(noPo.every((r) => r.stage === "no_po")).toBe(true)

		const onlyPaid = await loadClaroInvoiceRows("paid", now, 2)
		expect(onlyPaid.map((r) => r.id)).toEqual([accepted.id, p3.id])
	})

	it("a short not yet accepted stays open; Home and the page read the same filter", async () => {
		const b = await sentBatch()
		const short = await mk({
			batchId: b.id,
			...paidOn("2099-02-01"),
			claroPaidNet: 90,
		})
		const rows = await loadClaroInvoiceRows("short", new Date(), 2)
		expect(rows.find((r) => r.id === short.id)?.stage).toBe("short")

		const findMany = vi.spyOn(db.ewitInvoice, "findMany")
		await loadClaroInvoiceRows("no_po", new Date(), 2)
		await loadComptrollerHome(new Date())
		const wheres = findMany.mock.calls.map((c) => c[0]?.where)
		findMany.mockRestore()
		expect(wheres.filter((w) => w === CLARO_OPEN)).toHaveLength(2)
	})
})
