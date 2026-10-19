import { describe, expect, it } from "vitest"
import { isLegacyPricedInvoice, uploadHref } from "./upload-href"

describe("uploadHref", () => {
	it("links a per-send packet file by its stored name", () => {
		expect(
			uploadHref(
				"/var/jaf/uploads/packets/doc1-packet-1700000000000-ab12cd34.pdf",
			),
		).toBe("/files/packets/doc1-packet-1700000000000-ab12cd34.pdf")
	})

	it("still links a legacy JAF invoice, and handles Windows separators", () => {
		expect(
			uploadHref("C:\\jaf\\uploads\\jaf-invoices\\doc1-jaf-invoice.pdf"),
		).toBe("/files/jaf-invoices/doc1-jaf-invoice.pdf")
	})
})

describe("isLegacyPricedInvoice", () => {
	it("is true only for a file in the old priced jaf-invoices/ folder", () => {
		expect(
			isLegacyPricedInvoice("/var/jaf/uploads/jaf-invoices/d1-jaf-invoice.pdf"),
		).toBe(true)
		expect(
			isLegacyPricedInvoice("C:\\jaf\\uploads\\jaf-invoices\\d1.pdf"),
		).toBe(true)
		expect(
			isLegacyPricedInvoice("/var/jaf/uploads/packets/d1-packet-1-ab.pdf"),
		).toBe(false)
	})
})
