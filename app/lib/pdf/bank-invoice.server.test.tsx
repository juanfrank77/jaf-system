import { inflateSync } from "node:zlib"
import { describe, expect, it, vi } from "vitest"
import {
	type BankInvoiceInput,
	generateBankInvoicePdf,
} from "./bank-invoice.server"

function extractTextTokensInOrder(bytes: Buffer): string[] {
	const str = bytes.toString("latin1")
	const streams = str.match(/stream\s*\n([\s\S]*?)\n?endstream/g) || []

	const tokens: string[] = []
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

		// Extract text-showing operators: Tj (show string) and TJ (show strings with spacing)
		// Match patterns like: (text)Tj, <hextext>Tj, and [...<hex> offset <hex>...]TJ
		const textOperators =
			streamData.match(
				/(\(([^)]*)\)|<([0-9a-fA-F]+)>)\s+Tj|\[[\s\S]*?\]\s*TJ/g,
			) || []

		for (const op of textOperators) {
			if (op.includes("TJ")) {
				// Extract hex strings from TJ array [...<hex1> offset <hex2>...]TJ
				const hexMatches = op.match(/<([0-9a-fA-F]+)>/g) || []
				for (const hexMatch of hexMatches) {
					const hex = hexMatch.slice(1, -1)
					try {
						const decoded = Buffer.from(hex, "hex").toString("latin1")
						tokens.push(decoded)
					} catch {
						// Ignore invalid hex
					}
				}
			} else if (op.includes("(")) {
				// Extract literal string from (text)Tj
				const literalMatch = op.match(/\(([^)]*)\)/)
				if (literalMatch) {
					tokens.push(literalMatch[1])
				}
			} else if (op.includes("<")) {
				// Extract hex string from <hex>Tj
				const hexMatch = op.match(/<([0-9a-fA-F]+)>/)
				if (hexMatch) {
					try {
						const decoded = Buffer.from(hexMatch[1], "hex").toString("latin1")
						tokens.push(decoded)
					} catch {
						// Ignore invalid hex
					}
				}
			}
		}
	}
	return tokens
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
		const pageCount = (pdfStr.match(/\/Type\s*\/Page(?![A-Za-z])/g) || [])
			.length
		expect(pageCount).toBeGreaterThan(1)
	})

	it("renders 3-line invoice on a single page", async () => {
		const bytes = await generateBankInvoicePdf(input)
		const pdfStr = bytes.toString("latin1")
		const pageCount = (pdfStr.match(/\/Type\s*\/Page(?![A-Za-z])/g) || [])
			.length
		expect(pageCount).toBe(1)
	})

	it("X mark appears exactly once for checked job kind", async () => {
		const kinds: Array<BankInvoiceInput["kind"]> = [
			"INSTALACION",
			"CONSTRUCCION",
			"MANTENIMIENTO",
		]

		for (const kind of kinds) {
			const bytes = await generateBankInvoicePdf({ ...input, kind })
			const tokens = extractTextTokensInOrder(bytes)
			const fullText = tokens.join("")

			// X should appear exactly once in the checkbox section
			const xCount = tokens.filter((t) => t === "X").length
			expect(xCount).toBe(1)

			// The kind label should appear in the PDF
			expect(fullText).toContain(kind)
		}
	})

	it("includes invoice number and total in PDF content", async () => {
		const bytes = await generateBankInvoicePdf(input)
		const tokens = extractTextTokensInOrder(bytes)
		const fullText = tokens.join("")

		expect(fullText).toContain(input.invoiceNumber)
		expect(fullText).toContain("118.45")
	})

	it("handles duplicate claroCode without React key warnings", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error")
		try {
			const duplicateLines: BankInvoiceInput = {
				...input,
				lines: [
					{ ...input.lines[0], description: "Line A" },
					{
						...input.lines[0],
						claroCode: input.lines[0].claroCode,
						description: "Line B",
					},
					{
						...input.lines[0],
						claroCode: input.lines[0].claroCode,
						description: "Line C",
					},
				],
			}
			const bytes = await generateBankInvoicePdf(duplicateLines)
			expect(bytes.subarray(0, 4).toString()).toBe("%PDF")

			// Assert console.error was NOT called with any key-related warning
			const errorCalls = consoleErrorSpy.mock.calls.flat()
			const hasKeyWarning = errorCalls.some(
				(arg) => typeof arg === "string" && arg.toLowerCase().includes("key"),
			)
			expect(hasKeyWarning).toBe(false)
		} finally {
			consoleErrorSpy.mockRestore()
		}
	})
})
