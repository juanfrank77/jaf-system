import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.finance.awaiting-ariba"
import { loader as zipLoader } from "./_app.finance.awaiting-ariba.zip"

const t = makeTracker()
let dir: string
const prev = process.env.UPLOAD_DIR
beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "ariba-route-"))
	process.env.UPLOAD_DIR = dir
})
afterAll(async () => {
	await t.cleanup()
	process.env.UPLOAD_DIR = prev
	await fs.rm(dir, { recursive: true, force: true })
})

async function setup() {
	const u = t.track("user", await seedUser({ role: "FINANCE" }))
	mocks.requireRole.mockResolvedValue({ user: u })
	const doc = t.track("jafInvoice", await seedFinanceableInvoice())
	const po = await db.claroPo.create({
		data: {
			poNumber: "4500526054",
			poDate: new Date("2026-09-04T12:00:00Z"),
			termsDays: 60,
			filePath: "x",
			fileName: "x.pdf",
			fileHash: runToken("h"),
			status: "CONFIRMED",
			docId: doc.id,
			subtotal: 100,
			ivu4: 0,
			ivu115: 11.5,
			total: 111.5,
			uploadedById: u.id,
		},
	})
	t.track("claroPo", po)
	return { u, po }
}

const post = (form: FormData) =>
	action({
		request: new Request("http://localhost/finance/awaiting-ariba", {
			method: "POST",
			body: form,
		}),
		params: {},
		context: {},
	} as never)

describe("Claro invoices route", () => {
	it("makes the selected PO's invoice and then lists it as not loaded", async () => {
		const { po } = await setup()
		const form = new FormData()
		form.set("intent", "make")
		form.append("poId", po.id)
		form.set(`month-${po.id}`, "2026-05")
		expect(await post(form)).toMatchObject({ made: 1, failed: 0 })
		const page = await loader({
			request: new Request(
				"http://localhost/finance/awaiting-ariba?tab=not_loaded",
			),
			params: {},
			context: {},
		} as never)
		expect(
			page.invoices.map((i: { poNumber: string }) => i.poNumber),
		).toContain("4500526054")
	})

	it("asks for a selection instead of doing nothing silently", async () => {
		await setup()
		const form = new FormData()
		form.set("intent", "mark_loaded")
		expect(await post(form)).toMatchObject({
			errorKey: "claro_invoices.errors.none_selected",
		})
	})

	it("serves a zip of the ticked invoices and rejects an empty request", async () => {
		const { po } = await setup()
		const form = new FormData()
		form.set("intent", "make")
		form.append("poId", po.id)
		form.set(`month-${po.id}`, "2026-05")
		await post(form)
		const inv = await db.claroInvoice.findFirstOrThrow({
			where: { claroPoId: po.id },
		})
		const res = await zipLoader({
			request: new Request(
				`http://localhost/finance/awaiting-ariba/zip?id=${inv.id}`,
			),
			params: {},
			context: {},
		} as never)
		expect(res.headers.get("Content-Type")).toBe("application/zip")
		await expect(
			zipLoader({
				request: new Request("http://localhost/finance/awaiting-ariba/zip"),
				params: {},
				context: {},
			} as never),
		).rejects.toMatchObject({ status: 400 })
	})
})
