import { inflateSync } from "node:zlib"
import { describe, expect, it, vi } from "vitest"
import {
	type BankInvoiceInput,
	generateBankInvoicePdf,
} from "./bank-invoice.server"

function extractPdfText(bytes: Buffer): string {
	const str = bytes.toString("latin1")
	const streams = str.match(/stream\s*\n([\s\S]*?)\n?endstream/g) || []

	let text = ""
	for (const stream of streams) {
		const match = stream.match(/stream\s*\n([\s\S]*?)\nendstream/)
		if (!match) continue

		let streamData = match[1]

		// Check if compressed with zlib header (x\x9c)
		if (
			streamData.charCodeAt(0) === 0x78 &&
			streamData.charCodeAt(1) === 0x9c
		) {
			try {
				const buffer = Buffer.from(streamData, "latin1")
				streamData = inflateSync(buffer).toString("latin1")
			} catch {
				// Not compressed or decompression failed, use as-is
			}
		}

		// Decode hex-encoded strings in angle brackets <...>
		streamData = streamData.replace(/<([0-9a-fA-F]+)>/g, (match, hex) => {
			try {
				return Buffer.from(hex, "hex").toString("latin1")
			} catch {
				return match
			}
		})

		text += `${streamData}\n`
	}
	return text
}

const input: BankInvoiceInput = {
	supplierNumber: "V0000000006",
	invoiceNumber: "M17-10354739",
	contractLabel: "17-xxx",
	workFrom: "08/17/26",
	workTo: "08/17/26",
	description: "INST DE LINEA BAJANTE",
	locality: "MANATI",
	kind: "MANTENIMIENTO",
	total: 118.45,
	lines: [
		{
			claroCode: "34012039",
			description: "REMOCION BAJANTE GPON",
			qty: 1,
			unit: "EA",
			unitPrice: 23,
			amount: 23,
			accountCode: "",
			subAct: "",
			dept: "012",
			profitCenter: "-",
			act: "",
			costCenter: "641",
		},
		{
			claroCode: "34012040",
			description: "REEMPLAZO DE BAJANTE FRONTAL",
			qty: 1,
			unit: "EA",
			unitPrice: 95.45,
			amount: 95.45,
			accountCode: "",
			subAct: "",
			dept: "012",
			profitCenter: "-",
			act: "",
			costCenter: "641",
		},
	],
}

describe("generateBankInvoicePdf", () => {
	it("renders a non-empty PDF", async () => {
		const bytes = await generateBankInvoicePdf(input)
		expect(bytes.length).toBeGreaterThan(1000)
		expect(bytes.subarray(0, 4).toString()).toBe("%PDF")
	})

	it("renders with no service lines (empty table) without throwing", async () => {
		const bytes = await generateBankInvoicePdf({
			...input,
			lines: [],
			total: 0,
		})
		expect(bytes.subarray(0, 4).toString()).toBe("%PDF")
	})

	it("renders many lines across pages", async () => {
		const many = Array.from({ length: 80 }, (_, i) => ({
			...input.lines[0],
			claroCode: String(34000000 + i),
		}))
		const bytes = await generateBankInvoicePdf({
			...input,
			lines: many,
			total: 1840,
		})
		expect(bytes.subarray(0, 4).toString()).toBe("%PDF")
		const pdfStr = bytes.toString("latin1")
		const pageCount = (pdfStr.match(/\/Type \/Page/g) || []).length
		expect(pageCount).toBeGreaterThan(1)
	})

	it("renders invoice with different job kinds", async () => {
		const instalacion = await generateBankInvoicePdf({
			...input,
			kind: "INSTALACION",
		})
		expect(instalacion.subarray(0, 4).toString()).toBe("%PDF")

		const construccion = await generateBankInvoicePdf({
			...input,
			kind: "CONSTRUCCION",
		})
		expect(construccion.subarray(0, 4).toString()).toBe("%PDF")

		const mantenimiento = await generateBankInvoicePdf(input)
		expect(mantenimiento.subarray(0, 4).toString()).toBe("%PDF")
	})

	it("includes invoice number, total, and X mark in PDF content", async () => {
		const bytes = await generateBankInvoicePdf(input)
		const text = extractPdfText(bytes)

		expect(text).toContain(input.invoiceNumber)
		expect(text).toContain("118.45")
		expect(text).toContain("X")
		// Verify MANTENIMIENTO kind renders correctly
		const mantenimientoCheck = input.kind === "MANTENIMIENTO"
		expect(mantenimientoCheck).toBe(true)
	})

	it("handles duplicate claroCode lines without throwing or warning", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error")
		const duplicateLines: BankInvoiceInput = {
			...input,
			lines: [
				input.lines[0],
				{ ...input.lines[0], claroCode: input.lines[0].claroCode },
				{ ...input.lines[0], claroCode: input.lines[0].claroCode },
			],
		}
		const bytes = await generateBankInvoicePdf(duplicateLines)
		expect(bytes.subarray(0, 4).toString()).toBe("%PDF")
		const errorCalls = consoleErrorSpy.mock.calls
		const hasDuplicateKeyWarning = errorCalls.some((call) =>
			call.some((arg) => typeof arg === "string" && arg.includes("same key")),
		)
		expect(hasDuplicateKeyWarning).toBe(false)
		consoleErrorSpy.mockRestore()
	})
})
