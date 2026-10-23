import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import { makeTracker, seedUser } from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))
vi.mock("~/lib/po-reader.server", () => ({ getPoReader: () => null }))

import { action, loader } from "./_app.finance.awaiting-po"
import { loader as fileLoader } from "./_app.finance.awaiting-po.$id.file"

const t = makeTracker()
let dir: string
const prev = process.env.UPLOAD_DIR
beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "po-route-"))
	process.env.UPLOAD_DIR = dir
})
afterAll(async () => {
	await t.cleanup()
	process.env.UPLOAD_DIR = prev
	await fs.rm(dir, { recursive: true, force: true })
})

const pdfFile = (name: string) =>
	new File([`%PDF-1.4\n% ${name}\n%%EOF\n`], name, { type: "application/pdf" })

function post(form: FormData) {
	return action({
		request: new Request("http://localhost/finance/awaiting-po", {
			method: "POST",
			body: form,
		}),
		params: {},
		context: {},
	} as never)
}

describe("PO inbox route", () => {
	it("requires FINANCE or ADMIN", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: u })
		mocks.requireRole.mockClear()
		await loader({
			request: new Request("http://localhost/finance/awaiting-po"),
			params: {},
			context: {},
		} as never)
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"FINANCE",
			"ADMIN",
		])
	})

	it("uploads several PDFs at once and queues each", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: u })
		const form = new FormData()
		form.set("intent", "upload")
		form.append("files", pdfFile("a.pdf"))
		form.append("files", pdfFile("b.pdf"))
		await post(form)
		const rows = await db.claroPo.findMany({ where: { uploadedById: u.id } })
		expect(rows).toHaveLength(2)
	})

	it("refuses an upload with a non-PDF in it, saving nothing", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: u })
		const form = new FormData()
		form.set("intent", "upload")
		form.append("files", pdfFile("ok.pdf"))
		form.append("files", new File(["x"], "x.exe", { type: "text/plain" }))
		const res = await post(form)
		expect(res).toMatchObject({ errorKey: "po_inbox.errors.not_pdf" })
		expect(await db.claroPo.count({ where: { uploadedById: u.id } })).toBe(0)
	})

	it("serves the stored PO file inline", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: u })
		const form = new FormData()
		form.set("intent", "upload")
		form.append("files", pdfFile("serve.pdf"))
		await post(form)
		const row = await db.claroPo.findFirstOrThrow({
			where: { uploadedById: u.id },
		})
		const res = await fileLoader({
			request: new Request("http://localhost/x"),
			params: { id: row.id },
			context: {},
		} as never)
		expect(res.headers.get("Content-Type")).toBe("application/pdf")
	})
})
