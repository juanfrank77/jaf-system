import ExcelJS from "exceljs"
import { afterAll, describe, expect, it, vi } from "vitest"
import { db } from "~/lib/db.server"
import {
	makeTracker,
	runToken,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const mocks = vi.hoisted(() => ({ requireRole: vi.fn() }))
vi.mock("~/lib/permissions.server", () => ({ requireRole: mocks.requireRole }))

import { loader as searchLoader } from "./_app.finance.avisos"
import { loader as avisoLoader } from "./_app.finance.avisos.$id"
import { loader as ledgerLoader } from "./_app.finance.ledger"
import { loader as exportLoader } from "./_app.finance.ledger.export"

const t = makeTracker()
afterAll(() => t.cleanup())

const call = <T>(fn: (a: never) => T, url: string, params: object = {}) =>
	fn({ request: new Request(url), params, context: {} } as never)

async function seed() {
	const u = t.track("user", await seedUser({ role: "FINANCE" }))
	mocks.requireRole.mockResolvedValue({ user: u })
	const avisoNumber = String(20000000 + Math.floor(Math.random() * 9999999))
	const doc = t.track(
		"jafInvoice",
		await seedFinanceableInvoice({
			avisoNumber,
			jafInvoiceLines: [
				{
					serviceCodeId: "s",
					claroCode: "c",
					name: "n",
					unit: "u",
					qty: 1,
					unitPrice: 100,
					lineAmount: 100,
				},
			],
		}),
	)
	const po = await db.claroPo.create({
		data: {
			poNumber: "4500526054",
			poDate: new Date("2026-09-04T12:00:00Z"),
			termsDays: 60,
			filePath: "x",
			fileName: "x.pdf",
			fileHash: runToken("h"),
			status: "CONFIRMED",
			confirmedAt: new Date(),
			docId: doc.id,
			subtotal: 100,
			ivu4: 0,
			ivu115: 11.5,
			total: 111.5,
			uploadedById: u.id,
		},
	})
	t.track("claroPo", po)
	return { u, doc, avisoNumber, po }
}

describe("Aviso record and Ledger routes", () => {
	it("opens the record with money, POs, documents and history", async () => {
		const { doc, avisoNumber } = await seed()
		const r = await call(avisoLoader, "http://x/finance/avisos/1", {
			id: doc.id,
		})
		expect(r.aviso.avisoNumber).toBe(avisoNumber)
		expect(r.aviso.money).toMatchObject({
			billed: 111.5,
			poed: 111.5,
			stillToPo: 0,
		})
		expect(r.aviso.pos[0].poDate.source).toBe("DOCUMENT")
		expect(r.documents.map((d: { label: string }) => d.label)).toContain(
			"PO 4500526054",
		)
	})

	it("search opens a single match straight to its record and lists several", async () => {
		const { doc, avisoNumber } = await seed()
		await expect(
			call(searchLoader, `http://x/finance/avisos?q=${avisoNumber}`),
		).rejects.toMatchObject({
			status: 302,
			headers: expect.anything(),
		})
		const none = await call(
			searchLoader,
			"http://x/finance/avisos?q=zzzz-no-such",
		)
		expect(none.results).toEqual([])
		expect(doc.id).toBeTruthy()
	})

	it("the Ledger lists an Aviso released inside the range and not outside it", async () => {
		const { doc } = await seed()
		const inside = await call(
			ledgerLoader,
			"http://x/finance/ledger?from=2000-01-01&to=2100-01-01",
		)
		expect(inside.data.rows.map((r: { id: string }) => r.id)).toContain(doc.id)
		const outside = await call(
			ledgerLoader,
			"http://x/finance/ledger?from=2000-01-01&to=2000-01-31",
		)
		expect(outside.data.rows.map((r: { id: string }) => r.id)).not.toContain(
			doc.id,
		)
	})

	it("exports an Excel file with one row for that Aviso", async () => {
		const { avisoNumber } = await seed()
		const res = (await call(
			exportLoader,
			"http://x/finance/ledger/export?from=2000-01-01&to=2100-01-01",
		)) as Response
		expect(res.headers.get("Content-Disposition")).toContain(
			"ledger-2000-01-01-to-2100-01-01.xlsx",
		)
		const wb = new ExcelJS.Workbook()
		await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as never)
		const ws = wb.getWorksheet("Ledger")
		const found = ws?.getColumn(1).values as unknown[]
		expect(found).toContain(avisoNumber)
	})

	it("requires FINANCE or ADMIN", async () => {
		await seed()
		mocks.requireRole.mockClear()
		await call(ledgerLoader, "http://x/finance/ledger")
		expect(mocks.requireRole).toHaveBeenCalledWith(expect.anything(), [
			"FINANCE",
			"ADMIN",
		])
	})
})
