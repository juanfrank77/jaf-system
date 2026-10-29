import fs from "node:fs/promises"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, runToken, seedUser } from "~/test/helpers"
import {
	addPo,
	claroRowView,
	claroStage,
	expectedClaroTotal,
	isClaroOverdue,
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
