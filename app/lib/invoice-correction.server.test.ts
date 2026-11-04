import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { db } from "~/lib/db.server"
import { billableMaterials } from "~/lib/finance-pipeline.server"
import {
	CorrectionError,
	correctToAviso,
	diffQty,
	type InvoiceOriginal,
	parseQtyLines,
} from "~/lib/invoice-correction.server"
import { rowAmounts } from "~/lib/pbcc-batch.server"
import type { InvoiceLine } from "~/lib/service-lines"
import {
	makeTracker,
	runToken,
	seedFinanceableInvoice,
	seedUser,
} from "~/test/helpers"

const t = makeTracker()
const digits = () => runToken("C").replace(/\D/g, "").slice(-8)

describe("parseQtyLines", () => {
	it("refuses a line with no code, a zero quantity or a repeated code", () => {
		for (const bad of [
			[{ serviceCodeId: "", qty: 1 }],
			[{ serviceCodeId: "a", qty: 0 }],
			[
				{ serviceCodeId: "a", qty: 1 },
				{ serviceCodeId: "a", qty: 2 },
			],
			"nope",
		])
			expect(() => parseQtyLines(bad)).toThrow(CorrectionError)
	})
})

describe("diffQty", () => {
	it("names changed, added and removed lines, old to new", () => {
		const label = (id: string) => ({ code: id, name: id })
		expect(
			diffQty(
				"service",
				[
					{ serviceCodeId: "a", qty: 1 },
					{ serviceCodeId: "b", qty: 2 },
				],
				[
					{ serviceCodeId: "a", qty: 3 },
					{ serviceCodeId: "c", qty: 1 },
				],
				label,
			),
		).toEqual([
			{ kind: "service", code: "a", name: "a", from: 1, to: 3 },
			{ kind: "service", code: "b", name: "b", from: 2, to: null },
			{ kind: "service", code: "c", name: "c", from: null, to: 1 },
		])
	})
})

describe("Correct to Aviso", { timeout: 60_000 }, () => {
	let docId: string
	let userId: string
	let svc: { id: string; claroCode: string }
	let other: { id: string; claroCode: string }
	let mat: { id: string }

	beforeAll(async () => {
		const code = (
			name: string,
			unitPrice: string,
			kind: "SERVICE" | "MATERIAL" = "SERVICE",
		) =>
			db.serviceCode.create({
				data: {
					claroCode: `L${digits()}`,
					name,
					kind,
					unit: "EA",
					unitPrice,
					accountCode: "610",
				},
			})
		svc = t.track("serviceCode", await code("POLE", "10"))
		other = t.track("serviceCode", await code("SPAN", "2.5"))
		mat = t.track("serviceCode", await code("BOLT", "1", "MATERIAL"))
		const user = t.track("user", await seedUser({ role: "FINANCE" }))
		userId = user.id
		const doc = t.track(
			"jafInvoice",
			await seedFinanceableInvoice({
				pbccRequestSentAt: null,
				jafInvoiceLines: [
					{
						serviceCodeId: svc.id,
						claroCode: svc.claroCode,
						name: "POLE",
						unit: "EA",
						qty: 2,
						// An older price: an untouched line keeps what it was billed at.
						unitPrice: 9,
						lineAmount: 18,
					},
				],
			}),
		)
		docId = doc.id
		await db.jafInvoice.update({
			where: { id: docId },
			data: {
				jafInvoiceLineTotal: 18,
				fieldMaterials: [
					{
						serviceCodeId: mat.id,
						used: 4,
						returned: 0,
						source: "WAREHOUSE_ISSUE",
					},
				],
			},
		})
	})
	afterAll(() => t.cleanup())

	const load = () => db.jafInvoice.findUniqueOrThrow({ where: { id: docId } })

	it("refuses when nothing changed, and writes nothing", async () => {
		await expect(
			correctToAviso({
				docId,
				userId,
				services: [{ serviceCodeId: svc.id, qty: 2 }],
				materials: [{ serviceCodeId: mat.id, qty: 4 }],
			}),
		).rejects.toThrow("no_changes")
		expect((await load()).invoiceVersion).toBe(1)
	})

	it("makes v2 at catalog prices, keeps v1 and logs old to new", async () => {
		const res = await correctToAviso({
			docId,
			userId,
			services: [
				{ serviceCodeId: svc.id, qty: 2 },
				{ serviceCodeId: other.id, qty: 4 },
			],
			materials: [{ serviceCodeId: mat.id, qty: 3 }],
			note: "Aviso shows the span",
		})
		expect(res.version).toBe(2)
		const doc = await load()
		const lines = doc.jafInvoiceLines as InvoiceLine[]
		// Untouched keeps its billed price; the added line takes the catalog's.
		expect(lines.map((l) => [l.claroCode, l.qty, l.lineAmount])).toEqual([
			[svc.claroCode, 2, 18],
			[other.claroCode, 4, 10],
		])
		expect(rowAmounts(doc).subtotal).toBe(28)
		expect(billableMaterials(doc)).toEqual([{ serviceCodeId: mat.id, qty: 3 }])
		const v1 = doc.invoiceOriginal as unknown as InvoiceOriginal
		expect(v1.lineTotal).toBe(18)
		expect(v1.lines).toHaveLength(1)
		const audit = await db.auditTrail.findFirstOrThrow({
			where: { docId, action: "FINANCE_CORRECTED", userId },
		})
		expect(audit.diffJson).toMatchObject({
			version: 2,
			note: "Aviso shows the span",
			changes: [
				expect.objectContaining({ kind: "service", from: null, to: 4 }),
				expect.objectContaining({ kind: "material", from: 4, to: 3 }),
			],
		})
	})

	it("a second correction makes v3 and leaves v1 as it was", async () => {
		const res = await correctToAviso({
			docId,
			userId,
			services: [{ serviceCodeId: svc.id, qty: 5 }],
			materials: [{ serviceCodeId: mat.id, qty: 3 }],
		})
		expect(res.version).toBe(3)
		const doc = await load()
		expect((doc.invoiceOriginal as unknown as InvoiceOriginal).lineTotal).toBe(
			18,
		)
		// A changed quantity takes the catalog's price.
		expect(rowAmounts(doc).subtotal).toBe(50)
	})
})
