import { describe, expect, it } from "vitest"
import { packageFiles, uniqueFileNames } from "./package-files"

const doc = (over: Partial<Parameters<typeof packageFiles>[0]> = {}) => ({
	id: "d1",
	controlNumber: "MAINT-261026-025",
	jafInvoicePdfPath: "/u/packets/d1-work-order-1.pdf",
	prefieldPdfPath: "/u/packets/d1-prefield-2.pdf",
	prefieldNeeded: true,
	blueprintPaths: ["/u/blueprints/d1/plano 1.pdf"],
	...over,
})
const photos = [
	{
		localPath: "/u/photos/d1/after.jpg",
		takenAt: new Date("2026-10-19T12:00Z"),
		tag: "AFTER",
	},
	{
		localPath: "/u/photos/d1/before.png",
		takenAt: new Date("2026-10-19T09:00Z"),
		tag: "BEFORE",
	},
]

describe("packageFiles", () => {
	it("lists the work order PDF, the Prefield PDF, the photos by time, then the blueprints", () => {
		const files = packageFiles(doc(), photos)
		expect(files.map((f) => f.key)).toEqual([
			"work_order_pdf",
			"prefield_pdf",
			"photo",
			"photo",
			"blueprint",
		])
		expect(files.map((f) => f.name)).toEqual([
			"d1-work-order-1.pdf",
			"d1-prefield-2.pdf",
			"before.png",
			"after.jpg",
			"plano 1.pdf",
		])
		expect(files[0]).toMatchObject({
			path: "/u/packets/d1-work-order-1.pdf",
			href: "/files/packets/d1-work-order-1.pdf",
		})
		expect(files[1].href).toBe("/files/packets/d1-prefield-2.pdf")
		expect(files[2]).toMatchObject({
			path: "/u/photos/d1/before.png",
			href: "/files/photos/d1/before.png",
		})
		expect(files[4]).toMatchObject({
			path: "/u/blueprints/d1/plano 1.pdf",
			href: "/files/blueprints/d1/plano%201.pdf",
		})
	})

	it("gives every file a friendly name: work order number, numbered photos with their stage", () => {
		const files = packageFiles(doc(), photos)
		expect(files.map((f) => f.fileName)).toEqual([
			"JAF work order MAINT-261026-025.pdf",
			"Prefield MAINT-261026-025.pdf",
			"Photo 1 - before.png",
			"Photo 2 - after.jpg",
			"Blueprint 1.pdf",
		])
	})

	it("numbers a photo without a stage plainly", () => {
		const files = packageFiles(
			doc({ blueprintPaths: [], prefieldNeeded: false }),
			[{ localPath: "/u/photos/d1/x.JPG", takenAt: new Date() }],
		)
		expect(files.at(-1)?.fileName).toBe("Photo 1.jpg")
	})

	it("leaves the Prefield PDF out when it is not needed, even if one is stored", () => {
		const files = packageFiles(doc({ prefieldNeeded: false }), [])
		expect(files.map((f) => f.key)).toEqual(["work_order_pdf", "blueprint"])
	})

	it("has no Prefield row when it is needed but not generated yet", () => {
		const files = packageFiles(doc({ prefieldPdfPath: null }), [])
		expect(files.map((f) => f.key)).toEqual(["work_order_pdf", "blueprint"])
	})

	it("lists no work order PDF unless it is the packet (not a priced invoice, not nothing)", () => {
		expect(
			packageFiles(
				doc({
					jafInvoicePdfPath: "/u/jaf-invoices/d1-jaf-invoice.pdf",
					prefieldNeeded: false,
					blueprintPaths: [],
				}),
				[],
			),
		).toEqual([])
		expect(
			packageFiles(
				doc({ jafInvoicePdfPath: null, prefieldNeeded: false }),
				[],
			).map((f) => f.key),
		).toEqual(["blueprint"])
	})

	it("never lists the Aviso or the Certificado", () => {
		const keys = packageFiles(doc(), photos).map((f) => f.key as string)
		expect(keys).not.toContain("aviso")
		expect(keys).not.toContain("certificado")
		expect(keys).not.toContain("precert")
	})
})

describe("uniqueFileNames", () => {
	it("numbers a repeated name before its extension", () => {
		expect(uniqueFileNames(["a.jpg", "b.pdf", "a.jpg", "a.jpg", "c"])).toEqual([
			"a.jpg",
			"b.pdf",
			"a-2.jpg",
			"a-3.jpg",
			"c",
		])
		expect(uniqueFileNames(["x", "x"])).toEqual(["x", "x-2"])
	})
})
