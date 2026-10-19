import { describe, expect, it } from "vitest"
import { uploadHref } from "./upload-href"

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
