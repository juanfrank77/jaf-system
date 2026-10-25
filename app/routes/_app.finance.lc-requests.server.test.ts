import fs from "node:fs/promises"
import path from "node:path"
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	seedBrigade,
	seedFinanceableInvoice,
	seedServiceCode,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { addToOpenBatch } from "~/lib/pbcc-batch.server"
import { action, loader } from "./_app.finance.lc-requests"

const t = makeTracker()
const docIds: string[] = []
const userIds: string[] = []

async function clearOpenBatches() {
	const open = await db.bankSchedule.findMany({
		where: { closedAt: null },
		select: { id: true },
	})
	await db.jafInvoice.updateMany({
		where: { bankScheduleId: { in: open.map((o) => o.id) } },
		data: { bankScheduleId: null },
	})
	await db.bankSchedule.deleteMany({
		where: { id: { in: open.map((o) => o.id) } },
	})
}
async function clearMine() {
	await db.auditTrail.deleteMany({ where: { docId: { in: docIds } } })
	await db.jafInvoice.updateMany({
		where: { id: { in: docIds } },
		data: { bankScheduleId: null },
	})
	await db.bankSchedule.deleteMany({
		where: { generatedById: { in: userIds } },
	})
	await db.jafInvoice.deleteMany({ where: { id: { in: docIds } } })
	docIds.length = 0
}
beforeEach(clearOpenBatches)
afterEach(clearMine)
afterAll(async () => {
	await clearMine()
	await t.cleanup()
})

async function finance() {
	const u = t.track("user", await seedUser({ role: "FINANCE" }))
	userIds.push(u.id)
	mocks.requireRole.mockResolvedValue({ user: u })
	return u
}

async function accepted(
	opts: { area?: string | null; subtotal?: number } = {},
) {
	const brigade = t.track("brigade", await seedBrigade({ area: "NORTE" }))
	if (opts.area === null)
		await db.brigade.update({ where: { id: brigade.id }, data: { area: null } })
	const sc = t.track(
		"serviceCode",
		await seedServiceCode(`LR-${Math.random().toString(36).slice(2, 10)}`, {
			unitPrice: 100,
		}),
	)
	const subtotal = opts.subtotal ?? 100
	const doc = t.track(
		"jafInvoice",
		await seedFinanceableInvoice({
			pbccRequestSentAt: null,
			jafInvoiceLines: [
				{
					serviceCodeId: sc.id,
					claroCode: sc.claroCode,
					name: "Line",
					unit: "EA",
					qty: 1,
					unitPrice: subtotal,
					lineAmount: subtotal,
				},
			],
		}),
	)
	docIds.push(doc.id)
	const aviso = `9${Math.floor(Math.random() * 1e9)}`
	const avisoFile = path.join(
		process.env.UPLOAD_DIR || "/tmp/jaf/uploads",
		"aviso-docs",
		`${doc.id}-aviso.pdf`,
	)
	await fs.mkdir(path.dirname(avisoFile), { recursive: true })
	await fs.writeFile(avisoFile, aviso)
	await db.jafInvoice.update({
		where: { id: doc.id },
		data: {
			brigadeId: brigade.id,
			financeVerifiedAt: new Date(),
			avisoNumber: aviso,
			avisoDocPath: avisoFile,
			jafInvoiceLineTotal: subtotal,
			jobAddressActual: "Calle Luna 55, Mayagüez PR 00680",
		},
	})
	return { id: doc.id, aviso, controlNumber: doc.controlNumber }
}

const load = (query = "") =>
	loader({
		request: new Request(`http://localhost/finance/lc-requests${query}`),
		params: {},
		context: {},
	} as never)
const post = (entries: Record<string, string>) =>
	action({
		request: new Request("http://localhost/finance/lc-requests", {
			method: "POST",
			body: new URLSearchParams(entries),
		}),
		params: {},
		context: {},
	} as never)

describe("PBCC batch screen", { timeout: 60_000 }, () => {
	it("restricts loader and action to FINANCE and ADMIN", async () => {
		await finance()
		mocks.requireRole.mockClear()
		await load()
		await post({ intent: "nothing" })
		expect(mocks.requireRole).toHaveBeenCalledTimes(2)
		for (const call of mocks.requireRole.mock.calls)
			expect(call[1]).toEqual(["FINANCE", "ADMIN"])
	})

	it("shows the one open batch with accepted packets as numbered rows", async () => {
		await finance()
		const a = await accepted({ subtotal: 100 })
		const b = await accepted({ subtotal: 50 })
		const result = (await load()) as never as {
			tab: string
			batch: {
				status: string
				count: number
				capacity: number
				subtotal: number
				advance: number
				rows: {
					id: string
					row: number
					invoiceNumber: string
					subtotal: number
					ivu: number
					total: number
					avisoHref: string | null
				}[]
			}
		}
		expect(result.tab).toBe("open")
		expect(result.batch.status).toBe("open")
		expect(result.batch.count).toBe(2)
		expect(result.batch.capacity).toBe(100)
		expect(result.batch.subtotal).toBe(150)
		expect(result.batch.advance).toBe(120)
		expect(result.batch.rows.map((r) => r.id).sort()).toEqual(
			[a.id, b.id].sort(),
		)
		expect(result.batch.rows.map((r) => r.row)).toEqual([1, 2])
		const row = result.batch.rows.find((r) => r.id === a.id)
		// 100.00 + 11.5% IVU
		expect(row).toMatchObject({ subtotal: 100, ivu: 11.5, total: 111.5 })
		expect(row?.invoiceNumber).toMatch(new RegExp(`-${a.aviso}$`))
		expect(row?.avisoHref).toMatch(/^\/files\/aviso-docs\//)
		// Loading twice never makes a second open batch.
		await load()
		expect(await db.bankSchedule.count({ where: { closedAt: null } })).toBe(1)
	})

	it("closes the batch, lands on it, and lists it under Ready to send", async () => {
		await finance()
		await accepted()
		const open = (await load()) as never as {
			batch: { id: string; number: number }
		}
		const closed = (await post({
			intent: "close_batch",
			batchId: open.batch.id,
		})) as Response
		expect(closed.status).toBe(302)
		const to = new URL(closed.headers.get("Location") ?? "", "http://x")
		expect(to.pathname).toBe(`/finance/schedules/${open.batch.id}`)
		expect(to.searchParams.get("receipt")).toBe("closed")
		const ready = (await load("?tab=ready")) as never as {
			tab: string
			batches: { id: string; status: string; count: number }[]
			readyCount: number
		}
		expect(ready.tab).toBe("ready")
		expect(ready.batches.find((b) => b.id === open.batch.id)).toMatchObject({
			status: "closed",
			count: 1,
		})
		expect(ready.readyCount).toBeGreaterThanOrEqual(1)
		// A closed, unsent batch is not under Sent.
		const sent = (await load("?tab=sent")) as never as {
			batches: { id: string }[]
		}
		expect(sent.batches.some((b) => b.id === open.batch.id)).toBe(false)
	})

	it("returns typed errors: empty batch, row with no area, take-out without a reason", async () => {
		await finance()
		const empty = (await load()) as never as { batch: { id: string } }
		expect(
			await post({ intent: "close_batch", batchId: empty.batch.id }),
		).toEqual({
			ok: false,
			errorKey: "pbcc_batch.errors.empty",
			list: "",
		})
		const noArea = await accepted({ area: null })
		// What Accept does for the packet it has just verified.
		await addToOpenBatch({ docId: noArea.id, userId: (await finance()).id })
		const filled = (await load()) as never as { batch: { id: string } }
		expect(
			await post({ intent: "close_batch", batchId: filled.batch.id }),
		).toEqual({
			ok: false,
			errorKey: "pbcc_batch.errors.no_area",
			list: noArea.controlNumber,
		})
		expect(
			await post({ intent: "take_out", docId: noArea.id, reason: " " }),
		).toMatchObject({
			errorKey: "pbcc_batch.errors.reason_required",
		})
	})

	it("takes a row out with its reason, and the row shows in the next batch", async () => {
		await finance()
		const a = await accepted()
		const b = await accepted()
		const open = (await load()) as never as { batch: { id: string } }
		expect(
			await post({ intent: "take_out", docId: b.id, reason: "wrong Aviso" }),
		).toEqual({ ok: true })
		await post({ intent: "close_batch", batchId: open.batch.id })
		const next = (await load()) as never as {
			batch: { rows: { id: string }[] }
		}
		expect(next.batch.rows.map((r) => r.id)).toEqual([b.id])
		expect(
			(await db.jafInvoice.findUniqueOrThrow({ where: { id: a.id } }))
				.bankScheduleId,
		).toBe(open.batch.id)
	})
})
