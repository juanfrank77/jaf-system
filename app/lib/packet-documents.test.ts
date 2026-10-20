import { describe, expect, it } from "vitest"
import { packetDocuments } from "./packet-documents"

const doc = {
	id: "job-1",
	jafInvoicePdfPath: "/uploads/packets/job-1-packet-2-ab.pdf",
	avisoNumber: "10353961",
	avisoDocPath: "/uploads/aviso-docs/job-1-aviso.pdf",
}
const sheet = {
	pdfPath: "/uploads/precert/job-1-v2.pdf",
	sigSupervisorAt: new Date("2026-10-01"),
	sigSubcontractorAt: new Date("2026-10-01"),
}
const photos = [
	{
		localPath: "/uploads/photos/job-1/after.jpg",
		tag: "AFTER" as const,
		takenAt: new Date("2026-10-02"),
	},
	{
		localPath: "/uploads/photos/job-1/before.jpg",
		tag: "BEFORE" as const,
		takenAt: new Date("2026-10-01"),
	},
]

describe("packetDocuments", () => {
	it("returns the four documents, each linking to its file", () => {
		expect(packetDocuments(doc, sheet, photos)).toEqual([
			{
				key: "work_order_pdf",
				label: "finance_verify.packet.work_order_pdf",
				detail: "",
				href: "/files/packets/job-1-packet-2-ab.pdf",
			},
			{
				key: "aviso",
				label: "finance_verify.packet.aviso",
				detail: "job-1-aviso.pdf",
				href: "/files/aviso-docs/job-1-aviso.pdf",
			},
			{
				key: "precert",
				label: "finance_verify.packet.precert",
				detail: "",
				href: "/files/precert/job-1-v2.pdf",
			},
			{
				key: "photos",
				label: "finance_verify.packet.photos",
				detail: "2",
				// The first photo taken; the photos route serves per-job folders.
				href: "/files/photos/job-1/before.jpg",
			},
		])
	})

	it("has a null href for each missing document", () => {
		const rows = packetDocuments(
			{
				...doc,
				// A legacy priced invoice is not the packet's work order PDF.
				jafInvoicePdfPath: "/uploads/jaf-invoices/job-1-jaf-invoice.pdf",
				avisoDocPath: null,
			},
			null,
			[],
		)
		expect(rows.map((r) => [r.key, r.href])).toEqual([
			["work_order_pdf", null],
			["aviso", null],
			["precert", null],
			["photos", null],
		])
		expect(rows.find((r) => r.key === "photos")?.detail).toBe("0")
	})

	it("does not link an unsigned pre-cert sheet", () => {
		const rows = packetDocuments(
			doc,
			{ ...sheet, sigSubcontractorAt: null },
			photos,
		)
		expect(rows.find((r) => r.key === "precert")?.href).toBeNull()
	})

	it("does not link photos without both a before and an after", () => {
		const rows = packetDocuments(doc, sheet, [photos[1]])
		expect(rows.find((r) => r.key === "photos")).toMatchObject({
			href: null,
			detail: "1",
		})
	})
})
