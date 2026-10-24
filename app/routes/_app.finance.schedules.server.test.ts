import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedFinanceableInvoice, seedUser } from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader as invoiceLoader } from "./_app.finance.pbcc.$id.invoice"
import { action, loader } from "./_app.finance.schedules.$id"
import { loader as packageLoader } from "./_app.finance.schedules.$id.package.$part"
import { loader as xlsxLoader } from "./_app.finance.schedules.$id.xlsx"

const t = makeTracker()
const tmpFiles: string[] = []
afterAll(async () => {
	await t.cleanup()
	await Promise.all(
		tmpFiles.map((f) => fs.rm(f, { force: true, recursive: true })),
	)
})

async function tmpFile(name: string, bytes: Buffer): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jaf-dl-"))
	const file = path.join(dir, name)
	await fs.writeFile(file, bytes)
	tmpFiles.push(file, dir)
	return file
}

async function schedule(
	generatedById: string,
	extra: {
		xlsxPath?: string | null
		sentAt?: Date | null
		closedAt?: Date | null
	} = {},
) {
	const s = await db.bankSchedule.create({
		data: {
			generatedById,
			advanceRate: 0.8,
			total: 100,
			advanceAmount: 80,
			// Closed unless a test says otherwise: batches built before the open
			// state existed all count as closed.
			closedAt: new Date(),
			// Numbered when closed; a high random one cannot collide with real batches.
			number: 1_000_000 + Math.floor(Math.random() * 1_000_000),
			...extra,
		},
	})
	return t.track("bankSchedule", s)
}

async function financeUser() {
	const finance = t.track("user", await seedUser({ role: "FINANCE" }))
	mocks.requireRole.mockResolvedValue({ user: finance })
	return finance
}

const post = (id: string, intent: string) =>
	action({
		request: new Request(`http://x/finance/schedules/${id}`, {
			method: "POST",
			body: new URLSearchParams({ intent }),
		}),
		params: { id },
		context: {},
	} as never)

describe("schedule routes", () => {
	it("loader returns a closed batch with its check and no package until the Excel exists", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id)
		const res = await loader({
			request: new Request(`http://x/finance/schedules/${s.id}`),
			params: { id: s.id },
			context: {},
		} as never)
		expect(res.batch.id).toBe(s.id)
		expect(res.batch.status).toBe("closed")
		expect(res.batch.rows).toEqual([])
		expect(res.batch.hasExcel).toBe(false)
		expect(res.parts).toEqual([])
		// An empty batch cannot pass its check.
		expect(res.check?.passed).toBe(false)
	})

	it("loader sends the open batch to its own screen, and does not re-check a sent one", async () => {
		const finance = await financeUser()
		const open = await schedule(finance.id, { closedAt: null })
		await expect(
			loader({
				request: new Request("http://x"),
				params: { id: open.id },
				context: {},
			} as never),
		).rejects.toMatchObject({
			status: 302,
			headers: expect.objectContaining({}),
		})
		const sent = await schedule(finance.id, { sentAt: new Date() })
		const res = await loader({
			request: new Request("http://x"),
			params: { id: sent.id },
			context: {},
		} as never)
		expect(res.batch.status).toBe("sent")
		expect(res.check).toBeNull()
	})

	it("loader requires FINANCE or ADMIN", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id)
		mocks.requireRole.mockClear()
		await loader({
			request: new Request("http://x"),
			params: { id: s.id },
			context: {},
		} as never)
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"FINANCE",
			"ADMIN",
		])
	})

	it("download routes allow FINANCE, COMPTROLLER and ADMIN", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id)
		mocks.requireRole.mockClear()
		await xlsxLoader({
			request: new Request("http://x"),
			params: { id: s.id },
			context: {},
		} as never).catch(() => null)
		await invoiceLoader({
			request: new Request("http://x"),
			params: { id: "nope" },
			context: {},
		} as never).catch(() => null)
		expect(mocks.requireRole).toHaveBeenNthCalledWith(1, expect.anything(), [
			"FINANCE",
			"COMPTROLLER",
			"ADMIN",
		])
		expect(mocks.requireRole).toHaveBeenNthCalledWith(2, expect.anything(), [
			"FINANCE",
			"COMPTROLLER",
			"ADMIN",
		])
	})

	it("loader 404s for an unknown schedule", async () => {
		await financeUser()
		await expect(
			loader({
				request: new Request("http://x"),
				params: { id: "nope" },
				context: {},
			} as never),
		).rejects.toMatchObject({ status: 404 })
	})

	it("xlsx route 404s when the schedule has no file", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id)
		await expect(
			xlsxLoader({
				request: new Request("http://x"),
				params: { id: s.id },
				context: {},
			} as never),
		).rejects.toMatchObject({ status: 404 })
	})

	it("invoice route 404s when the packet has no bank invoice", async () => {
		await financeUser()
		await expect(
			invoiceLoader({
				request: new Request("http://x"),
				params: { id: "nope" },
				context: {},
			} as never),
		).rejects.toMatchObject({ status: 404 })
	})

	it("xlsx route serves the file with the spreadsheet type and filename", async () => {
		const finance = await financeUser()
		const bytes = Buffer.from("fake-xlsx-bytes")
		const file = await tmpFile("s.xlsx", bytes)
		const s = await schedule(finance.id, { xlsxPath: file })
		const res = (await xlsxLoader({
			request: new Request("http://x"),
			params: { id: s.id },
			context: {},
		} as never)) as Response
		expect(res.status).toBe(200)
		expect(res.headers.get("Content-Type")).toBe(
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		)
		expect(res.headers.get("Content-Disposition")).toContain(
			`schedule-${s.number}.xlsx`,
		)
		expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes)
	})

	it("xlsx route 404s when the path is set but the file is gone", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id, {
			xlsxPath: path.join(os.tmpdir(), "jaf-dl-missing", "nope.xlsx"),
		})
		await expect(
			xlsxLoader({
				request: new Request("http://x"),
				params: { id: s.id },
				context: {},
			} as never),
		).rejects.toMatchObject({ status: 404 })
	})

	it("invoice route serves the PDF with a sanitised filename", async () => {
		await financeUser()
		const bytes = Buffer.from("%PDF-fake")
		const file = await tmpFile("i.pdf", bytes)
		const doc = t.track("jafInvoice", await seedFinanceableInvoice())
		await db.jafInvoice.update({
			where: { id: doc.id },
			data: { bankInvoicePdfPath: file, controlNumber: 'JAF "x" 1' },
		})
		const res = (await invoiceLoader({
			request: new Request("http://x"),
			params: { id: doc.id },
			context: {},
		} as never)) as Response
		expect(res.status).toBe(200)
		expect(res.headers.get("Content-Type")).toBe("application/pdf")
		expect(res.headers.get("Content-Disposition")).toBe(
			'attachment; filename="JAF__x__1-bank-invoice.pdf"',
		)
		expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes)
	})

	it("invoice route 404s when the file is gone or no invoice was built", async () => {
		await financeUser()
		const gone = t.track("jafInvoice", await seedFinanceableInvoice())
		await db.jafInvoice.update({
			where: { id: gone.id },
			data: {
				bankInvoicePdfPath: path.join(os.tmpdir(), "jaf-dl-missing", "x.pdf"),
			},
		})
		const none = t.track("jafInvoice", await seedFinanceableInvoice())
		for (const id of [gone.id, none.id]) {
			await expect(
				invoiceLoader({
					request: new Request("http://x"),
					params: { id },
					context: {},
				} as never),
			).rejects.toMatchObject({ status: 404 })
		}
	})

	it("mark_sent on an open batch returns not_closed and does not stamp", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id, { closedAt: null })
		expect(await post(s.id, "mark_sent")).toMatchObject({
			ok: false,
			errorKey: "pbcc_batch.errors.not_closed",
		})
		const row = await db.bankSchedule.findUniqueOrThrow({ where: { id: s.id } })
		expect(row.sentAt).toBeNull()
	})

	it("mark_sent on a closed batch whose check is not green returns check_failed and does not stamp", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id)
		expect(await post(s.id, "mark_sent")).toMatchObject({
			ok: false,
			errorKey: "pbcc_batch.errors.check_failed",
		})
		const row = await db.bankSchedule.findUniqueOrThrow({ where: { id: s.id } })
		expect(row.sentAt).toBeNull()
	})

	it("mark_sent on an already sent batch changes nothing", async () => {
		const finance = await financeUser()
		const sentAt = new Date("2026-10-01T12:00:00Z")
		const s = await schedule(finance.id, { sentAt })
		expect(await post(s.id, "mark_sent")).toMatchObject({ ok: true })
		const row = await db.bankSchedule.findUniqueOrThrow({ where: { id: s.id } })
		expect(row.sentAt).toEqual(sentAt)
	})

	it("mark_sent for an unknown batch 404s, and an unknown intent is refused", async () => {
		const finance = await financeUser()
		await expect(post("nope", "mark_sent")).rejects.toMatchObject({
			status: 404,
		})
		const s = await schedule(finance.id)
		expect(await post(s.id, "discard")).toMatchObject({
			ok: false,
			errorKey: "pbcc_batch.errors.unknown_intent",
		})
	})
})

describe("package route", () => {
	const get = (id: string, part: string) =>
		packageLoader({
			request: new Request("http://x"),
			params: { id, part },
			context: {},
		} as never) as Promise<Response>

	it("404s for an unknown or still-open batch", async () => {
		const finance = await financeUser()
		expect((await get("nope", "1")).status).toBe(404)
		const open = await schedule(finance.id, { closedAt: null })
		expect((await get(open.id, "1")).status).toBe(404)
	})

	it("refuses with 409 while the batch check is not green", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id)
		expect((await get(s.id, "1")).status).toBe(409)
	})

	it("serves a part of a sent batch as a zip, and 404s a part that does not exist", async () => {
		const finance = await financeUser()
		const xlsx = await tmpFile("schedule.xlsx", Buffer.from("xlsx-bytes"))
		const s = await schedule(finance.id, { xlsxPath: xlsx, sentAt: new Date() })
		const res = await get(s.id, "1")
		expect(res.status).toBe(200)
		expect(res.headers.get("Content-Type")).toBe("application/zip")
		expect(res.headers.get("Content-Disposition")).toMatch(
			/PBCC_Batch_\d+_Part_1_of_1\.zip/,
		)
		expect((await get(s.id, "2")).status).toBe(404)
	})

	it("requires FINANCE or ADMIN", async () => {
		const finance = await financeUser()
		const s = await schedule(finance.id)
		mocks.requireRole.mockClear()
		await get(s.id, "1")
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"FINANCE",
			"ADMIN",
		])
	})
})
