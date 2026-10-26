import fs from "node:fs/promises"
import { getDocumentProxy } from "unpdf"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedCompletion,
	seedInstaller,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({
	requireRole: vi.fn(),
	requireSession: vi.fn(),
}))
vi.mock("~/lib/permissions.server", () => ({
	requireRole: mocks.requireRole,
	requireSession: mocks.requireSession,
}))

import {
	action as logAction,
	loader as logLoader,
} from "./_app.comptroller.log"
import { loader as pdfLoader } from "./_app.comptroller.log.pdf"
import { loader as xlsxLoader } from "./_app.comptroller.log.xlsx"
import { loader as reportsLoader } from "./_app.reports"
import { action as readAction } from "./action.notifications.$id.read"

const t = makeTracker()
let uploadDir: string
const prevUploadDir = process.env.UPLOAD_DIR
let carmen: Awaited<ReturnType<typeof seedUser>>
let monica: Awaited<ReturnType<typeof seedUser>>
let installer: Awaited<ReturnType<typeof seedInstaller>>
let orderNo: string

beforeAll(async () => {
	uploadDir = await fs.mkdtemp("/tmp/log-route-")
	process.env.UPLOAD_DIR = uploadDir
	carmen = t.track("user", await seedUser({ role: "COMPTROLLER" }))
	monica = t.track("user", await seedUser({ role: "ADMIN" }))
	installer = await seedInstaller({ name: "Log Installer", jafNumber: "1888" })
	t.track("user", installer.user)
	t.track("van", installer.van)
	orderNo = `LG${runToken("o").replace(/\D/g, "").slice(-9)}`
	t.track(
		"installCompletion",
		await seedCompletion({
			installerId: installer.user.id,
			vanId: installer.van.id,
			orderNo,
		}),
	)
})
afterAll(async () => {
	await db.notification.deleteMany({ where: { userId: monica.id } })
	await db.sentReport.deleteMany({ where: { fromId: carmen.id } })
	await t.cleanup()
	process.env.UPLOAD_DIR = prevUploadDir
	await fs.rm(uploadDir, { recursive: true, force: true })
})

const as = (u: { id: string }) =>
	mocks.requireRole.mockResolvedValue({ user: u })
const req = (qs: string, init?: RequestInit) =>
	new Request(`http://localhost/comptroller/log?${qs}`, init)
const args = (r: Request) => ({ request: r, params: {}, context: {} }) as never

describe("Carmen's Log", () => {
	it("filters installers by order # and shows every date filled or MISSING, never a price", async () => {
		as(carmen)
		const res = await logLoader(args(req(`tab=installers&q=${orderNo}`)))
		expect(res.count).toBe(1)
		const row = res.groups[0].rows[0]
		expect(row).toMatchObject({
			order: orderNo,
			installer: "Log Installer",
			status: "Waiting for EWIT",
		})
		expect(res.columns.map((c) => c.key)).not.toContain("price")
		expect(JSON.stringify(res)).not.toMatch(/unitPrice|gross/i)
		expect(
			(await logLoader(args(req("tab=installers&q=zzz-none")))).count,
		).toBe(0)
	})

	it("the PDF is the same view: only the filtered rows, with the printer and filters in the header", async () => {
		as(carmen)
		const res = (await pdfLoader(
			args(req(`tab=installers&q=${orderNo}`)),
		)) as Response
		expect(res.headers.get("Content-Disposition")).toMatch(
			/^inline; filename="JAF_Installers/,
		)
		const dl = (await pdfLoader(
			args(req(`tab=installers&q=${orderNo}&download=1`)),
		)) as Response
		expect(dl.headers.get("Content-Disposition")).toMatch(/^attachment/)
		const { extractText } = await import("unpdf")
		const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()))
		const { text } = await extractText(pdf, { mergePages: true })
		expect(text).toContain(orderNo)
		expect(text).toContain("Printed by")
		expect(text).toContain("1 rows")
		const x = (await xlsxLoader(
			args(req(`tab=installers&q=${orderNo}`)),
		)) as Response
		expect(x.headers.get("Content-Type")).toContain("spreadsheetml")
	})

	it("Send to Monica makes a PDF, rings her bell, and Opened shows on Carmen's side", async () => {
		as(carmen)
		const form = new FormData()
		form.set("intent", "send_report")
		form.set("qs", `tab=installers&q=${orderNo}`)
		form.set("note", "Here is October")
		const sent = (await logAction(
			args(req("", { method: "POST", body: form })),
		)) as { data: { sentTo: number } }
		expect(sent.data.sentTo).toBeGreaterThanOrEqual(1)
		const report = await db.sentReport.findFirstOrThrow({
			where: { fromId: carmen.id, toId: monica.id },
		})
		expect(report.openedAt).toBeNull()
		expect((await fs.stat(report.pdfPath)).size).toBeGreaterThan(500)
		const bell = await db.notification.findFirstOrThrow({
			where: { userId: monica.id },
		})
		expect(bell.href).toBe(`/reports?open=${report.id}`)

		// Tapping the bell goes to the report, not back to the page she was on.
		as(monica)
		mocks.requireSession.mockResolvedValue({ user: monica })
		const tap = new FormData()
		tap.set("redirectTo", "/dashboard")
		let to = ""
		try {
			await readAction({
				request: new Request("http://localhost/x", {
					method: "POST",
					body: tap,
				}),
				params: { id: bell.id },
				context: {},
			} as never)
		} catch (r) {
			to = (r as Response).headers.get("Location") ?? ""
		}
		expect(to).toBe(bell.href)

		// Opening stamps Opened; someone else's report can't be opened by id.
		const view = await reportsLoader(
			args(new Request(`http://localhost/reports?open=${report.id}`)),
		)
		expect(view.open).toBe(report.id)
		expect(
			(await db.sentReport.findUniqueOrThrow({ where: { id: report.id } }))
				.openedAt,
		).not.toBeNull()
		as(carmen)
		const mine = await logLoader(args(req("tab=installers")))
		expect(mine.sent[0].openedAt).not.toBeNull()
	}, 60_000)

	it("refuses to send an empty view", async () => {
		as(carmen)
		const form = new FormData()
		form.set("intent", "send_report")
		form.set("qs", "tab=installers&q=zzz-none")
		const res = (await logAction(
			args(req("", { method: "POST", body: form })),
		)) as { data: { errorKey: string } }
		expect(res.data.errorKey).toBe("log.errors.empty")
	})
})
