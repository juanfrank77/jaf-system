import { readFile } from "node:fs/promises"
import { Document, Page, renderToBuffer, Text } from "@react-pdf/renderer"
import { createElement } from "react"
import { describe, expect, it } from "vitest"
import {
	AvisoPdfError,
	avisoNumberFromText,
	normaliseAvisoNumber,
	readAvisoNumber,
} from "./aviso-pdf.server"

const FIXTURE =
	"docs/JAF_Package/04 Sample Documents by Entity (Templates)/Finance Journey Example (single Aviso)/1.  AVISO 739.pdf"

/** A one-page PDF whose text layer is `lines` (none: a page with no text, like a scan). */
async function pdfWith(lines: string[]): Promise<Uint8Array> {
	const page = createElement(
		Page,
		{ size: "A4" },
		...lines.map((l) => createElement(Text, { key: l }, l)),
	)
	return new Uint8Array(
		await renderToBuffer(createElement(Document, null, page)),
	)
}

const codeOf = async (p: Promise<unknown>) =>
	p.then(
		() => "resolved",
		(e) => (e instanceof AvisoPdfError ? e.code : String(e)),
	)

describe("avisoNumberFromText", () => {
	it("reads the one Aviso number, even when the print repeats it", () => {
		expect(avisoNumberFromText("Aviso #10350001Aviso #10350001\nrows")).toBe(
			"10350001",
		)
	})

	it("rejects two distinct Aviso numbers", () => {
		expect(() =>
			avisoNumberFromText("Aviso #10350001\nAviso # 10350002"),
		).toThrowError(expect.objectContaining({ code: "multiple_numbers" }))
	})

	it("rejects text with no Aviso number", () => {
		expect(() => avisoNumberFromText("SERVICIOS REALIZADOS")).toThrowError(
			expect.objectContaining({ code: "no_number" }),
		)
	})

	it("treats an empty text layer (a scan) as unreadable", () => {
		expect(() => avisoNumberFromText("  \n ")).toThrowError(
			expect.objectContaining({ code: "unreadable" }),
		)
	})
})

describe("normaliseAvisoNumber", () => {
	it("keeps digits only", () => {
		expect(normaliseAvisoNumber(" #1035 0001 ")).toBe("10350001")
	})
})

describe("readAvisoNumber", () => {
	it("reads the number from the real Claro print", async () => {
		const bytes = new Uint8Array(await readFile(FIXTURE))
		expect(await readAvisoNumber(bytes)).toBe("10354739")
	})

	it("reports garbage bytes as unreadable", async () => {
		expect(await codeOf(readAvisoNumber(new Uint8Array([1, 2, 3])))).toBe(
			"unreadable",
		)
	})

	it("reports a PDF with no text (a scan) as unreadable", async () => {
		expect(await codeOf(readAvisoNumber(await pdfWith([])))).toBe("unreadable")
	})

	it("reports a text PDF with no Aviso number", async () => {
		expect(
			await codeOf(readAvisoNumber(await pdfWith(["Orden de trabajo 123"]))),
		).toBe("no_number")
	})

	it("reports a PDF carrying several different Aviso numbers", async () => {
		expect(
			await codeOf(
				readAvisoNumber(await pdfWith(["Aviso #10350001", "Aviso #10350002"])),
			),
		).toBe("multiple_numbers")
	})
})
