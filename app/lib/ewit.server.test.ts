import fs from "node:fs/promises"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedCompletion,
	seedInstaller,
	seedUser,
} from "~/test/helpers"
import {
	buildEwitPackage,
	checkEwitBatch,
	closeEwitBatch,
	createEwitInvoice,
	type EwitError,
	loadInstallerPayList,
	loadWarrantyDocs,
	markEwitBatchSent,
	payInstallers,
	receiveStatement,
	removeEwitInvoice,
	undoInstallerPayment,
} from "./ewit.server"

const t = makeTracker()
const pdf = (name = "invoice.pdf") =>
	new File([new Uint8Array([37, 80, 68, 70, 45])], name, {
		type: "application/pdf",
	})
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)

let carmen: Awaited<ReturnType<typeof seedUser>>
let installer: Awaited<ReturnType<typeof seedInstaller>>
let uploadDir: string
const prevUploadDir = process.env.UPLOAD_DIR

beforeAll(async () => {
	uploadDir = await fs.mkdtemp("/tmp/ewit-test-")
	process.env.UPLOAD_DIR = uploadDir
	carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
	installer = await seedInstaller({ name: "A. Rosario", jafNumber: "1820" })
	t.track("user", installer.user)
	t.track("van", installer.van)
})
afterAll(async () => {
	await t.cleanup()
	process.env.UPLOAD_DIR = prevUploadDir
	await fs.rm(uploadDir, { recursive: true, force: true })
})

const order = () => `ORD${runToken("o").replace(/\D/g, "").slice(-9)}`
const doc = async (orderNo = order(), installedAt = new Date()) =>
	t.track(
		"installCompletion",
		await seedCompletion({
			installerId: installer.user.id,
			vanId: installer.van.id,
			orderNo,
			installedAt,
		}),
	)
const invoice = (over: Partial<Parameters<typeof createEwitInvoice>[0]> = {}) =>
	createEwitInvoice({
		number: runToken("EW"),
		invoiceDate: new Date(),
		total: 4760.25,
		file: pdf(),
		completionIds: [],
		typedOrderNos: [],
		userId: carmen.id,
		...over,
	})
const track = async (p: ReturnType<typeof invoice>) => {
	const r = await p
	t.track("ewitInvoice", { id: r.id })
	return r
}
const code = (p: Promise<unknown>) =>
	p.then(
		() => null,
		(e: EwitError) => e.code,
	)

describe("warranty docs", () => {
	it("lists a submitted completion with its installer, Emp #, age and photo; flags old and duplicate ones", async () => {
		const fresh = await doc()
		const old = await doc(order(), daysAgo(20))
		const dupNo = order()
		await doc(dupNo)
		await doc(dupNo)
		const mine = (await loadWarrantyDocs()).filter(
			(d) => d.installerId === installer.user.id,
		)
		const f = mine.find((d) => d.id === fresh.id)
		expect(f).toMatchObject({
			installerName: "A. Rosario",
			empNo: "1820",
			stale: false,
			duplicate: false,
		})
		expect(f?.photoPath).toContain(".jpg")
		expect(mine.find((d) => d.id === old.id)).toMatchObject({
			stale: true,
			daysWaiting: 20,
		})
		expect(
			mine.filter((d) => d.orderNo === dupNo).every((d) => d.duplicate),
		).toBe(true)
		// Oldest first.
		const ages = mine.map((d) => d.daysWaiting)
		expect(ages).toEqual([...ages].sort((a, b) => b - a))
	})
})

describe("EWIT invoice", () => {
	it("saves with its orders, adds a row to the open batch and clears them from the warranty list", async () => {
		const a = await doc()
		const b = await doc()
		const made = await track(invoice({ completionIds: [a.id, b.id] }))
		const inv = await db.ewitInvoice.findUniqueOrThrow({
			where: { id: made.id },
			include: { batch: true, completions: true },
		})
		t.track("ewitBatch", inv.batch as { id: string })
		expect(inv.completions.map((c) => c.id).sort()).toEqual([a.id, b.id].sort())
		expect(inv.batch?.closedAt).toBeNull()
		const left = (await loadWarrantyDocs()).map((d) => d.id)
		expect(left).not.toContain(a.id)
		expect(left).not.toContain(b.id)
	})

	it("blocks over $5,000, a duplicate invoice #, a missing PDF and an order already on an invoice", async () => {
		const a = await doc()
		const number = runToken("EWDUP")
		await track(invoice({ number, completionIds: [a.id] }))
		const b = await doc()
		expect(await code(invoice({ completionIds: [b.id], total: 5000.01 }))).toBe(
			"over_limit",
		)
		expect(await code(invoice({ completionIds: [b.id], number }))).toBe(
			"duplicate_number",
		)
		expect(await code(invoice({ completionIds: [b.id], file: null }))).toBe(
			"no_file",
		)
		expect(await code(invoice({ completionIds: [a.id] }))).toBe(
			"order_on_invoice",
		)
		expect(await code(invoice())).toBe("no_orders")
		// A full $5,000.00 is fine.
		await track(invoice({ completionIds: [b.id], total: 5000 }))
	})

	it("saves a typed order # that has no warranty photo yet, flagged, and blocks it on a second invoice", async () => {
		const typed = order()
		const made = await track(invoice({ typedOrderNos: [typed] }))
		expect(made.unmatched).toEqual([typed])
		expect(await code(invoice({ typedOrderNos: [typed] }))).toBe(
			"order_on_invoice",
		)
	})

	it("a typed order # that matches a warranty doc takes that doc", async () => {
		const d = await doc()
		const made = await track(invoice({ typedOrderNos: [d.claroOrderNo] }))
		expect(made.unmatched).toEqual([])
		const stored = await db.installCompletion.findUniqueOrThrow({
			where: { id: d.id },
		})
		expect(stored.ewitInvoiceId).toBe(made.id)
	})

	it("voids an invoice before its batch closes: orders return to the list; after sending it is held with a reason", async () => {
		const a = await doc()
		const made = await track(invoice({ completionIds: [a.id] }))
		const res = await removeEwitInvoice({
			invoiceId: made.id,
			userId: carmen.id,
			reason: "typed by mistake",
		})
		expect(res.mode).toBe("voided")
		expect((await loadWarrantyDocs()).map((d) => d.id)).toContain(a.id)
		// Gone for good: a second remove finds nothing.
		expect(
			await code(
				removeEwitInvoice({
					invoiceId: made.id,
					userId: carmen.id,
					reason: "",
				}),
			),
		).toBe("not_found")
	})
})

describe("installer batch, statement and pay", () => {
	it("closes, checks, packages, is sent, takes PBCC's statement and is paid out", async () => {
		const jobs = [await doc(), await doc(), await doc()]
		const one = await track(
			invoice({ completionIds: [jobs[0].id], total: 1000 }),
		)
		const two = await track(
			invoice({ completionIds: [jobs[1].id, jobs[2].id], total: 2000 }),
		)
		const batchId = (
			await db.ewitInvoice.findUniqueOrThrow({ where: { id: one.id } })
		).batchId as string
		t.track("ewitBatch", { id: batchId })

		// Not closed: nothing to package or send.
		expect(await code(markEwitBatchSent({ batchId, userId: carmen.id }))).toBe(
			"not_closed",
		)
		await closeEwitBatch({ batchId, userId: carmen.id })
		const closed = await db.ewitBatch.findUniqueOrThrow({
			where: { id: batchId },
		})
		expect(closed.number).toBeGreaterThan(0)
		expect(Number(closed.total)).toBeGreaterThanOrEqual(3000)
		const check = await checkEwitBatch(batchId)
		expect(check).toMatchObject({
			excel: true,
			totalMatches: true,
			passed: true,
		})
		// A closed batch is locked: no taking an invoice back.
		expect(
			await code(
				removeEwitInvoice({
					invoiceId: one.id,
					userId: carmen.id,
					reason: "x",
				}),
			),
		).toBe("batch_closed")
		const pkg = await buildEwitPackage(batchId)
		expect(pkg.zip.length).toBeGreaterThan(0)
		expect(pkg.name).toMatch(/^JAF_Installers_PBCC_\d+\.zip$/)
		// A new open batch took its place.
		expect(
			await db.ewitBatch.count({
				where: { closedAt: null, createdById: carmen.id },
			}),
		).toBe(1)
		t.track("ewitBatch", {
			id: (
				await db.ewitBatch.findFirstOrThrow({
					where: { closedAt: null, createdById: carmen.id },
				})
			).id,
		})

		await markEwitBatchSent({ batchId, userId: carmen.id })
		expect(
			(await markEwitBatchSent({ batchId, userId: carmen.id })).alreadySent,
		).toBe(true)

		// Not paid by PBCC yet: no installer pay.
		const none = (await loadInstallerPayList()).find(
			(r) => r.installerId === installer.user.id,
		)
		expect(none).toBeUndefined()

		// The statement lists only the first invoice; the second stays waiting.
		const received = new Date()
		await receiveStatement({
			batchId,
			receivedAt: received,
			amount: 1000,
			file: pdf("statement.pdf"),
			invoiceIds: [one.id],
			userId: carmen.id,
		})
		const [a, b] = await Promise.all([
			db.ewitInvoice.findUniqueOrThrow({ where: { id: one.id } }),
			db.ewitInvoice.findUniqueOrThrow({ where: { id: two.id } }),
		])
		expect(a.receivedAt).not.toBeNull()
		expect(b.receivedAt).toBeNull()
		const batch = await db.ewitBatch.findUniqueOrThrow({
			where: { id: batchId },
		})
		expect(Number(batch.receivedAmount)).toBe(1000)
		expect(batch.statementPath).toContain("pbcc-statements")

		// Only the received invoice's order is on the pay list.
		const row = (await loadInstallerPayList()).find(
			(r) => r.installerId === installer.user.id,
		)
		expect(row).toMatchObject({ jobs: 1, empNo: "1820" })
		expect(row?.orders).toEqual([jobs[0].claroOrderNo])

		await payInstallers({
			items: [{ installerId: installer.user.id, amount: 180 }],
			paidAt: new Date(),
			userId: carmen.id,
		})
		const paid = await db.installCompletion.findUniqueOrThrow({
			where: { id: jobs[0].id },
			include: { installerPayment: true },
		})
		expect(Number(paid.installerPayment?.amount)).toBe(180)
		t.track("installerPayment", paid.installerPayment as { id: string })
		// Nothing left to pay for them.
		expect(
			await code(
				payInstallers({
					items: [{ installerId: installer.user.id, amount: 1 }],
					paidAt: new Date(),
					userId: carmen.id,
				}),
			),
		).toBe("nothing_to_pay")

		// Undo: needs a reason, same day only; the job goes back on the list.
		const paymentId = paid.installerPaymentId as string
		expect(await code(undoInstallerPayment({ paymentId, reason: " " }))).toBe(
			"no_reason",
		)
		expect(
			await code(
				undoInstallerPayment({
					paymentId,
					reason: "wrong amount",
					now: daysAgo(-2),
				}),
			),
		).toBe("undo_expired")
		await undoInstallerPayment({ paymentId, reason: "wrong amount" })
		expect(
			(await loadInstallerPayList()).find(
				(r) => r.installerId === installer.user.id,
			)?.jobs,
		).toBe(1)
	}, 90_000)

	it("refuses a statement for a batch that was never sent, and a bad pay amount", async () => {
		expect(
			await code(
				receiveStatement({
					batchId: (
						await db.ewitBatch.findFirstOrThrow({ where: { sentAt: null } })
					).id,
					receivedAt: new Date(),
					amount: 10,
					file: pdf(),
					invoiceIds: [],
					userId: carmen.id,
				}),
			),
		).toBe("not_sent")
		expect(
			await code(
				payInstallers({
					items: [{ installerId: installer.user.id, amount: 0 }],
					paidAt: new Date(),
					userId: carmen.id,
				}),
			),
		).toBe("bad_amount")
	})
})
