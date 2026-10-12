import { inflateSync } from "node:zlib"
import { describe, expect, it, vi } from "vitest"
import {
	type BankInvoiceInput,
	generateBankInvoicePdf,
} from "./bank-invoice.server"

/** Text tokens of each content stream (one per page; NOT in page order). */
function extractStreamTokens(bytes: Buffer): string[][] {
	const str = bytes.toString("latin1")
	const streams = str.match(/stream\s*\n([\s\S]*?)\n?endstream/g) || []

	const perStream: string[][] = []
	for (const stream of streams) {
		const tokens: string[] = []
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
		if (tokens.length > 0) perStream.push(tokens)
	}
	return perStream
}

function extractTextTokensInOrder(bytes: Buffer): string[] {
	return extractStreamTokens(bytes).flat()
}

/** All text of the PDF, tokens joined with no separator. */
function fullText(bytes: Buffer): string {
	return extractTextTokensInOrder(bytes).join("")
}

function pageCount(bytes: Buffer): number {
	return (bytes.toString("latin1").match(/\/Type\s*\/Page(?![A-Za-z])/g) || [])
		.length
}

/** The line table's header row, all twelve columns, in order. */
const TABLE_HEADER = [
	"No. de",
	"Servicio",
	"DESCRIPCION",
	"CANTIDAD",
	"U/M",
	"PRECIO",
	"UNITARIO",
	"IMPORTE",
	"A/C",
	"SUB ACT",
	"DEPT.",
	"PROFIT CENTER",
	"ACT",
	"CENTRO",
	"CODIGO COSTO",
].join("")

const input: BankInvoiceInput = {
	supplierNumber: "V0000000006",
	avisoNumber: "10354739",
	org: "PWOR",
	invoiceDate: "08/20/26",
	contractLabel: "17-xxx",
	workFrom: "08/17/26",
	workTo: "08/18/26",
	description: "INST DE LINEA BAJANTE",
	barrio: "BO TIERRAS NUEVAS",
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

	it("renders many lines across pages, repeating the table header on every page", async () => {
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
		const pages = pageCount(bytes)
		expect(pages).toBeGreaterThan(1)
		// One content stream per page; streams are not stored in page order, so
		// assert that EVERY page (page 2 included) carries the header row.
		const streams = extractStreamTokens(bytes)
		expect(streams).toHaveLength(pages)
		const withHeader = streams.filter((t) => t.join("").includes(TABLE_HEADER))
		expect(withHeader).toHaveLength(pages)
		// The form header and main box are printed once, on page 1 only.
		const withBox = streams.filter((t) =>
			t.join("").includes("NUMERO SUPLIDOR"),
		)
		expect(withBox).toHaveLength(1)
	})

	it("renders a 2-line invoice on a single page", async () => {
		const bytes = await generateBankInvoicePdf(input)
		expect(pageCount(bytes)).toBe(1)
	})

	it("X mark appears exactly once adjacent to checked job kind label", async () => {
		const kinds: Array<BankInvoiceInput["kind"]> = [
			"INSTALACION",
			"CONSTRUCCION",
			"MANTENIMIENTO",
		]

		for (const kind of kinds) {
			const bytes = await generateBankInvoicePdf({ ...input, kind })
			const tokens = extractTextTokensInOrder(bytes)

			// X should appear exactly once
			const xCount = tokens.filter((t) => t === "X").length
			expect(xCount).toBe(1)

			// react-pdf fragments text in reading order with the X immediately
			// BEFORE its own label, so join the tokens that follow the X. Every
			// token holds at least one character, so kind.length tokens always
			// cover the whole label however finely it is fragmented.
			const xIndex = tokens.indexOf("X")
			expect(xIndex).toBeGreaterThanOrEqual(0)
			const after = tokens.slice(xIndex + 1, xIndex + 1 + kind.length).join("")
			expect(after.length).toBeGreaterThan(0)

			// The text right after the single X is the rendered kind's label...
			expect(after.startsWith(kind)).toBe(true)
			// ...and not either of the other two labels.
			for (const otherKind of kinds.filter((k) => k !== kind)) {
				expect(after.startsWith(otherKind)).toBe(false)
			}
		}
	})

	it("prints the plain aviso as the invoice number, and the total", async () => {
		const text = fullText(await generateBankInvoicePdf(input))
		expect(text).toContain("10354739")
		expect(text).not.toContain("M17-")
		expect(text).toContain("118.45")
	})

	it("prints the page header like JAF's sample", async () => {
		const text = fullText(await generateBankInvoicePdf(input))
		expect(text).toContain(
			"JAF Communications, Inc.PO Box 11468, CAPARRA HEIGHTS, PR 00922",
		)
		expect(text).toContain("ACTA DE CONFORMIDADContrato Núm. 17-xxx")
		expect(text).toContain("FACTURA / CERTIFICACIONDE CONTRATISTA A P.R.T.")
	})

	it("fills the main box: supplier, aviso, ORG, FECHA, work dates, description, cost block", async () => {
		const text = fullText(await generateBankInvoicePdf(input))
		// Labels row, then the values row in the same column order.
		expect(text).toContain("NUMERO SUPLIDORNUMERO DE FACTURAORG.FECHA")
		expect(text).toContain("V000000000610354739PWOR08/20/26")
		expect(text).toContain("NUM. DE ORDEN DE COMPRA")
		expect(text).toContain(
			"DESCRIPCION DEL TRABAJOINST DE LINEA BAJANTEBO TIERRAS NUEVASLocalidad: MANATI",
		)
		expect(text).toContain("TRABAJO EFECTUADOENTRE08/17/2608/18/26")
		expect(text).toContain("COSTO TOTAL:CONTRATOFACTURADOBALANCE$$$")
		expect(text).toContain("TOTAL A PAGAR $$ 118.45")
		expect(text).toContain("Certificado por:FECHA:")
		expect(text.match(/Aprobado por:FECHA:/g)).toHaveLength(3)
		expect(text).toContain("M-3545ORDEN TRABAJO PLANTA:")
	})

	it("omits the barrio line when there is none", async () => {
		const text = fullText(
			await generateBankInvoicePdf({ ...input, barrio: "" }),
		)
		expect(text).toContain("INST DE LINEA BAJANTELocalidad: MANATI")
	})

	it("prints all twelve column headers, the lines, and the totals block", async () => {
		const text = fullText(await generateBankInvoicePdf(input))
		expect(text).toContain(TABLE_HEADER)
		expect(text).toContain(
			"34012039REMOCION BAJANTE GPON1.00EA23.0023.00012-641",
		)
		expect(text).toContain(
			"Total$ 118.45Resumen:$118.45- - -Total$ 118.45Firma: ",
		)
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
