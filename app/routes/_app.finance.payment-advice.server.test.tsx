import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Document, Page, renderToBuffer, Text } from "@react-pdf/renderer"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { makeInvoice } from "~/lib/claro-invoice.server"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { action, loader } from "./_app.finance.payment-advice"

const t = makeTracker()
let dir: string
const prev = process.env.UPLOAD_DIR
beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "advice-route-"))
	process.env.UPLOAD_DIR = dir
})
afterAll(async () => {
	await t.cleanup()
	process.env.UPLOAD_DIR = prev
	await fs.rm(dir, { recursive: true, force: true })
})

const post = (form: FormData) =>
	action({
		request: new Request("http://localhost/finance/payment-advice", {
			method: "POST",
			body: form,
		}),
		params: {},
		context: {},
	} as never)

describe("Payment Advice route", () => {
	it("uploads, lists the advice for review, applies it, and moves it to Applied", async () => {
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
		const inv = await makeInvoice({
			poId: po.id,
			workMonth: "2026-05",
			madeById: u.id,
		})
		const ref = String(5300000000 + Math.floor(Math.random() * 99999999))
		const pdf = await renderToBuffer(
			<Document>
				<Page size="LETTER">
					{[
						"Oct. 01, 2026",
						`Referencia ${ref}`,
						`M19-${inv.seq} 5920050399 03.07.2026 $111.50 $0.00 $0.00 $111.50`,
						"Total $111.50",
					].map((l) => (
						<Text key={l}>{l}</Text>
					))}
				</Page>
			</Document>,
		)
		const form = new FormData()
		form.set("intent", "upload")
		form.set(
			"file",
			new File([new Uint8Array(pdf)], "adv.pdf", { type: "application/pdf" }),
		)
		expect(await post(form)).toEqual({})
		const page = await loader({
			request: new Request(
				"http://localhost/finance/payment-advice?tab=upload",
			),
			params: {},
			context: {},
		} as never)
		const card = page.advices.find(
			(a: { reference: string | null }) => a.reference === ref,
		)
		expect(card?.totalOk).toBe(true)
		const apply = new FormData()
		apply.set("intent", "apply")
		apply.set("adviceId", card?.id ?? "")
		expect(await post(apply)).toEqual({})
		const applied = await loader({
			request: new Request(
				"http://localhost/finance/payment-advice?tab=applied",
			),
			params: {},
			context: {},
		} as never)
		expect(applied.advices.map((a: { id: string }) => a.id)).toContain(card?.id)
	}, 90000)

	it("answers a bad upload with an error key, not a crash", async () => {
		const u = t.track("user", await seedUser({ role: "FINANCE" }))
		mocks.requireRole.mockResolvedValue({ user: u })
		const form = new FormData()
		form.set("intent", "upload")
		expect(await post(form)).toMatchObject({
			errorKey: "payment_advice.errors.no_file",
		})
	})
})
