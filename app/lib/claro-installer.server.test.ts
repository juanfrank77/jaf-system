import fs from "node:fs/promises"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, runToken, seedUser } from "~/test/helpers"
import { addPo, claroStage, markAribaSent } from "./claro-installer.server"

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
	process.env.UPLOAD_DIR = prevUploadDir
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
