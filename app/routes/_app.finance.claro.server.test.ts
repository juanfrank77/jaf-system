import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("~/lib/permissions.server", () => ({ requireRole: vi.fn() }))
vi.mock("~/lib/po-inbox.server", async (orig) => ({
	...(await orig<typeof import("~/lib/po-inbox.server")>()),
	kickProcessing: vi.fn(),
}))

import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import { kickProcessing } from "~/lib/po-inbox.server"
import { makeTracker, runToken, seedUser } from "~/test/helpers"
import { action, loader } from "./_app.finance.claro"

const t = makeTracker()
let uploadDir: string
const prevDir = process.env.UPLOAD_DIR
let userId: string

beforeAll(async () => {
	uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), "claro-load-"))
	process.env.UPLOAD_DIR = uploadDir
	const u = await seedUser({ role: "FINANCE" })
	t.track("user", u)
	userId = u.id
	vi.mocked(requireRole).mockResolvedValue({ user: { id: userId } } as any)
})
afterAll(async () => {
	await t.cleanup()
	process.env.UPLOAD_DIR = prevDir
	await fs.rm(uploadDir, { recursive: true, force: true })
})

const pdfFile = (name: string, tag: string) =>
	new File([`%PDF-1.4\n% ${tag}\n`], name, { type: "application/pdf" })
const run = (form: FormData) =>
	action({
		request: new Request("http://localhost/finance/claro", {
			method: "POST",
			body: form,
		}),
		params: {},
	} as any).catch((r) => r)

async function seedPo(
	status: "PENDING" | "READY" | "CONFIRMED" | "SUPERSEDED",
	tag: string,
) {
	return t.track(
		"claroPo",
		await db.claroPo.create({
			data: {
				filePath: "x",
				fileName: `${tag}.pdf`,
				fileHash: runToken(tag),
				uploadedById: userId,
				status,
			},
		}),
	)
}
async function seedInvoice(poId: string, paid: boolean, loaded: boolean) {
	await db.claroInvoice.create({
		data: {
			series: runToken("S"),
			seq: 1,
			claroPoId: poId,
			workMonth: "2026-05",
			subtotal: 1,
			ivu4: 0,
			ivu115: 0,
			total: 1,
			madeById: userId,
			loadedAt: loaded ? new Date() : null,
			paidAt: paid ? new Date() : null,
		},
	})
}

describe("/finance/claro loader", () => {
	it("lists open POs with their step, hides SUPERSEDED and paid", async () => {
		const fresh = await seedPo("PENDING", "fresh")
		const ready = await seedPo("READY", "ready")
		const conf = await seedPo("CONFIRMED", "conf")
		const sup = await seedPo("SUPERSEDED", "sup")
		const paid = await seedPo("CONFIRMED", "paid")
		await seedInvoice(paid.id, true, true)
		const loaded = await seedPo("CONFIRMED", "loaded")
		await seedInvoice(loaded.id, false, true)
		vi.mocked(kickProcessing).mockClear()
		const { queue } = await loader({
			request: new Request("http://localhost/finance/claro"),
			params: {},
		} as any)
		// A PO at step 1 gets its read started again (a restart can leave it).
		expect(kickProcessing).toHaveBeenCalled()
		const step = (id: string) => queue.find((r) => r.id === id)?.step
		expect(step(fresh.id)).toBe(1)
		expect(step(ready.id)).toBe(2)
		expect(step(conf.id)).toBe(3)
		expect(step(loaded.id)).toBe(5)
		expect(step(sup.id)).toBeUndefined()
		expect(step(paid.id)).toBeUndefined()
	})
})

describe("/finance/claro action", () => {
	it("process with two PDFs creates two rows and redirects to the first", async () => {
		const form = new FormData()
		form.set("intent", "process")
		form.append("files", pdfFile("a.pdf", runToken("a")))
		form.append("files", pdfFile("b.pdf", runToken("b")))
		const res = await run(form)
		expect(res).toBeInstanceOf(Response)
		const rows = await db.claroPo.findMany({
			where: { uploadedById: userId, fileName: { in: ["a.pdf", "b.pdf"] } },
		})
		expect(rows).toHaveLength(2)
		for (const r of rows) t.track("claroPo", r)
		const first = rows.find((r) => r.fileName === "a.pdf")!
		expect(res.headers.get("Location")).toBe(
			`/finance/claro/${first.id}?step=review`,
		)
		expect(kickProcessing).toHaveBeenCalled()
	})

	it("a non-PDF returns the not_pdf key and stores nothing", async () => {
		const before = await db.claroPo.count({ where: { uploadedById: userId } })
		const form = new FormData()
		form.set("intent", "process")
		form.append("files", new File(["hi"], "x.txt", { type: "text/plain" }))
		expect(await run(form)).toEqual({ errorKey: "po_inbox.errors.not_pdf" })
		expect(await db.claroPo.count({ where: { uploadedById: userId } })).toBe(
			before,
		)
	})

	it("no files returns the no_files key", async () => {
		const form = new FormData()
		form.set("intent", "process")
		expect(await run(form)).toEqual({ errorKey: "po_inbox.errors.no_files" })
	})
})
