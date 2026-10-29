import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, runToken, seedUser } from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.comptroller.installers.claro.invoices"

const t = makeTracker()
let dir: string
let carmen: Awaited<ReturnType<typeof seedUser>>
const prev = process.env.UPLOAD_DIR
beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "claro-inv-route-"))
	process.env.UPLOAD_DIR = dir
	carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
	mocks.requireRole.mockResolvedValue({ user: carmen })
})
afterAll(async () => {
	await t.cleanup()
	if (prev === undefined) delete process.env.UPLOAD_DIR
	else process.env.UPLOAD_DIR = prev
	await fs.rm(dir, { recursive: true, force: true })
})

const mk = async (over: Record<string, unknown> = {}) => {
	const inv = await db.ewitInvoice.create({
		data: {
			number: runToken("JA").replace(/[^A-Z0-9]/g, ""),
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

const post = (fields: Record<string, string | string[] | File>) => {
	const fd = new FormData()
	for (const [k, v] of Object.entries(fields))
		for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x)
	return action({
		request: new Request("http://x/comptroller/installers/claro/invoices", {
			method: "POST",
			body: fd,
		}),
		params: {},
		context: {},
	} as never)
}
const pdfFile = () =>
	new File([new TextEncoder().encode("%PDF-1.4 x")], "re.pdf", {
		type: "application/pdf",
	})
const poFields = (id: string, total: string) => ({
	intent: "add_po",
	invoiceId: id,
	poNumber: "4500123456",
	poDate: "2026-10-20",
	reprintTotal: total,
	poFile: pdfFile(),
})

describe("Claro invoices page", () => {
	it("refuses a non-comptroller role", async () => {
		mocks.requireRole.mockRejectedValueOnce(new Response("no", { status: 403 }))
		await expect(post({ intent: "mark_sent" })).rejects.toBeInstanceOf(Response)
		mocks.requireRole.mockRejectedValueOnce(new Response("no", { status: 403 }))
		await expect(
			loader({
				request: new Request("http://x/"),
				params: {},
				context: {},
			} as never),
		).rejects.toBeInstanceOf(Response)
	})

	it("adds a PO with the right total and re-matches waiting JA advice rows", async () => {
		const inv = await mk()
		const advice = await db.paymentAdvice.create({
			data: {
				adviceDate: new Date(),
				total: 5066.41,
				rowsTotal: 5066.41,
				fileName: "a.pdf",
				filePath: "/x",
				fileHash: runToken("h"),
				uploadedById: carmen.id,
				lines: {
					create: [
						{
							position: 0,
							invoiceRef: inv.number,
							amount: 5066.41,
							withholding: 0,
							discount: 0,
							net: 5066.41,
							result: "UNMATCHED",
						},
					],
				},
			},
			include: { lines: true },
		})
		const res = (await post(poFields(inv.id, "5066.41"))) as {
			errorKey?: string
		}
		expect(res.errorKey).toBeUndefined()
		const after = await db.ewitInvoice.findUniqueOrThrow({
			where: { id: inv.id },
		})
		expect(after.poNumber).toBe("4500123456")
		expect(Number(after.claroTotal)).toBe(5066.41)
		const line = await db.adviceLine.findUniqueOrThrow({
			where: { id: advice.lines[0].id },
		})
		expect(line.result).toBe("MATCHED")
		expect(line.ewitInvoiceId).toBe(inv.id)
	})

	it("a wrong total says what was expected and writes nothing", async () => {
		const inv = await mk()
		const res = (await post(poFields(inv.id, "4871.55"))) as {
			errorKey?: string
			expected?: string
		}
		expect(res.errorKey).toBe(
			"installers.claro_invoices.errors.po_total_mismatch",
		)
		expect(res.expected).toBe("5,066.41")
		const after = await db.ewitInvoice.findUniqueOrThrow({
			where: { id: inv.id },
		})
		expect(after.poNumber).toBeNull()
		expect(after.claroTotal).toBeNull()
	})

	it("marks several invoices sent in Ariba on the chosen date", async () => {
		const a = await mk({ poNumber: "P1", claroTotal: 5066.41 })
		const b = await mk({ poNumber: "P2", claroTotal: 5066.41 })
		const res = (await post({
			intent: "mark_sent",
			invoiceIds: [a.id, b.id],
			sentOn: "2026-10-25",
		})) as { errorKey?: string }
		expect(res.errorKey).toBeUndefined()
		for (const id of [a.id, b.id]) {
			const r = await db.ewitInvoice.findUniqueOrThrow({ where: { id } })
			expect(r.aribaSentAt?.toISOString().slice(0, 10)).toBe("2026-10-25")
			expect(r.aribaSentById).toBe(carmen.id)
		}
	})

	it("reports nothing selected and a missing PO", async () => {
		const none = (await post({
			intent: "mark_sent",
			sentOn: "2026-10-25",
		})) as {
			errorKey?: string
		}
		expect(none.errorKey).toBe("installers.claro_invoices.errors.none_selected")
		const noPo = await mk()
		const r = (await post({
			intent: "mark_sent",
			invoiceIds: [noPo.id],
			sentOn: "2026-10-25",
		})) as { errorKey?: string }
		expect(r.errorKey).toBe("installers.claro_invoices.errors.no_po")
	})
})
