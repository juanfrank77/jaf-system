import { describe, expect, it } from "vitest"
import { evaluateReleaseGate } from "./release-gate"

const now = new Date()
const good = {
	doc: {
		jafInvoicePdfPath: "/var/jaf/uploads/packets/doc1-packet-1.pdf",
		avisoNumber: "10353961",
		avisoDocPath: "/x/aviso.pdf",
	},
	sheet: { sigSupervisorAt: now, sigSubcontractorAt: now },
	photos: [{ tag: "BEFORE" as const }, { tag: "AFTER" as const }],
}

describe("evaluateReleaseGate", () => {
	it("passes with the four documents and returns exactly four rows", () => {
		const r = evaluateReleaseGate(good)
		expect(r.ok).toBe(true)
		expect(r.rows.map((x) => x.key)).toEqual([
			"work_order_pdf",
			"aviso",
			"precert_signed",
			"photos",
		])
		expect(r.rows.find((x) => x.key === "aviso")?.detail).toBe("10353961")
		expect(r.rows.find((x) => x.key === "photos")?.detail).toBe(2)
	})
	it.each([
		["work_order_pdf", { doc: { ...good.doc, jafInvoicePdfPath: null } }],
		["aviso", { doc: { ...good.doc, avisoNumber: null } }],
		["aviso", { doc: { ...good.doc, avisoDocPath: null } }],
		["precert_signed", { sheet: null }],
		[
			"precert_signed",
			{ sheet: { sigSupervisorAt: now, sigSubcontractorAt: null } },
		],
		["photos", { photos: [] }],
	])("fails %s when missing", (key, patch) => {
		const r = evaluateReleaseGate({ ...good, ...patch })
		expect(r.ok).toBe(false)
		expect(r.rows.find((x) => x.key === key)?.ok).toBe(false)
		expect(r.rows.filter((x) => !x.ok)).toHaveLength(1)
	})
	it("fails photos with only DURING photos", () => {
		const r = evaluateReleaseGate({ ...good, photos: [{ tag: "DURING" }] })
		expect(r.ok).toBe(false)
		expect(r.rows.find((x) => x.key === "photos")?.ok).toBe(false)
	})
	it("fails photos with only BEFORE, or BEFORE + DURING", () => {
		for (const photos of [
			[{ tag: "BEFORE" as const }],
			[{ tag: "BEFORE" as const }, { tag: "DURING" as const }],
			[{ tag: null }],
		]) {
			const r = evaluateReleaseGate({ ...good, photos })
			expect(r.ok).toBe(false)
			expect(r.rows.find((x) => x.key === "photos")?.ok).toBe(false)
		}
	})
	it("treats a legacy priced-invoice path as no work order PDF", () => {
		const r = evaluateReleaseGate({
			...good,
			doc: { ...good.doc, jafInvoicePdfPath: "/u/jaf-invoices/doc1.pdf" },
		})
		expect(r.ok).toBe(false)
		expect(r.rows.find((x) => x.key === "work_order_pdf")?.ok).toBe(false)
	})
	it("has no approved, invoice, amount_match or contractor_code rows", () => {
		const keys = evaluateReleaseGate(good).rows.map((x) => x.key as string)
		for (const k of ["approved", "invoice", "amount_match", "contractor_code"])
			expect(keys).not.toContain(k)
	})
})
