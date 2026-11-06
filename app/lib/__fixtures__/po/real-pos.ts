import ocr4500517939 from "./4500517939.ocr.json"
import ocr4500518285 from "./4500518285.ocr.json"
import ocr4500518597 from "./4500518597.ocr.json"

/**
 * Real 4-page POs as printed by Claro (PDFs in this folder), with what their
 * text layer says, which JAF's M19 invoices billed to the cent. `ocr` is the
 * four passes ocrPdfPasses made of each PDF, saved as-is: what a scan of the
 * PO reads as. Service POs print no quantity x price sub-row; the amount is
 * only on the item's own row, as "Subtotal <amount>".
 */
export const REAL_POS = [
	{
		po: "4500518285",
		poDate: "2026-07-15",
		ocr: ocr4500518285 as string[],
		lines: [
			{ amount: 367.68, ivuRate: 0.115, ivu: 42.29 },
			{ amount: 457.5, ivuRate: 0.115, ivu: 52.62 },
		],
		subtotal: 825.18,
		ivu4: 0,
		ivu115: 94.91,
		total: 920.09,
	},
	{
		po: "4500518597",
		poDate: "2026-07-16",
		ocr: ocr4500518597 as string[],
		lines: [
			{ amount: 103.95, ivuRate: 0.04, ivu: 4.16 },
			{ amount: 200, ivuRate: 0.115, ivu: 23 },
		],
		subtotal: 303.95,
		ivu4: 4.16,
		ivu115: 23,
		total: 331.11,
	},
	{
		po: "4500517939",
		poDate: "2026-07-13",
		ocr: ocr4500517939 as string[],
		lines: [{ amount: 505, ivuRate: 0.04, ivu: 20.2 }],
		subtotal: 505,
		ivu4: 20.2,
		ivu115: 0,
		total: 525.2,
	},
]
