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

	it("shows the Claro columns: PO, Ariba, Claro paid, short, days, and sums the money", async () => {
		as(carmen)
		const tok = `CL${runToken("c").replace(/\D/g, "").slice(-6)}`
		const noon = (d: string) => new Date(`${d}T16:00:00Z`)
		const batch = await db.ewitBatch.create({
			data: { createdById: carmen.id, sentAt: noon("2026-07-07") },
		})
		t.track("ewitBatch", { id: batch.id })
		const mk = async (
			suffix: string,
			over: Record<string, unknown>,
		): Promise<void> => {
			const inv = await db.ewitInvoice.create({
				data: {
					number: `${tok}${suffix}`,
					invoiceDate: noon("2026-07-01"),
					total: 4600,
					filePath: "/files/x.pdf",
					createdById: carmen.id,
					batchId: batch.id,
					receivedAt: noon("2026-07-10"),
					poNumber: "4500518065",
					aribaSentAt: noon("2026-07-27"),
					claroPaidAt: noon("2026-10-09"),
					...over,
				} as never,
			})
			t.track("ewitInvoice", { id: inv.id })
			t.track(
				"installCompletion",
				await db.installCompletion.create({
					data: {
						idempotencyKey: runToken("IDK"),
						claroOrderNo: `${tok}${suffix}`,
						installerId: installer.user.id,
						vanId: installer.van.id,
						status: "SUBMITTED",
						address: "x",
						installedAt: noon("2026-07-01"),
						submittedAt: noon("2026-07-01"),
						ewitInvoiceId: inv.id,
					},
				}),
			)
		}
		await mk("A", { claroTotal: 5066.41, claroPaidNet: 5066.41 })
		await mk("B", { claroTotal: 5097.08, claroPaidNet: 5059.63 })
		const res = await logLoader(args(req(`tab=installers&q=${tok}`)))
		const rows = res.groups.flatMap((g) => g.rows)
		const a = rows.find((r) => r.order === `${tok}A`)
		const b = rows.find((r) => r.order === `${tok}B`)
		expect(a).toMatchObject({
			sold: "2026-07-07",
			po: "4500518065",
			aribaSent: "2026-07-27",
			claroPaid: "2026-10-09",
			daysPbccClaro: 94,
			claroAmount: 5066.41,
			withIvu: 5066.41,
			short: null,
		})
		expect(b).toMatchObject({
			claroAmount: 5059.63,
			withIvu: 5097.08,
			short: 37.45,
		})
		expect(b?.status).toContain("Claro short")
		expect(res.totals.withIvu).toBeCloseTo(10163.49, 2)
		expect(res.totals.claroAmount).toBeCloseTo(10126.04, 2)
		expect(res.totals.short).toBeCloseTo(37.45, 2)
		const keys = res.columns.map((c) => c.key)
		expect(keys.slice(keys.indexOf("amount") + 1, -1)).toEqual([
			"po",
			"withIvu",
			"aribaSent",
			"claroPaid",
			"claroAmount",
			"short",
			"daysPbccClaro",
		])
	})
})
