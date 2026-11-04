import { describe, expect, it } from "vitest"
import { parseAdvice } from "./advice-parse"

const ROW = (n: number, v: number, amt: string) =>
	`M19-${n} 59200503${v} 03.07.2026 ${amt} $0.00 $0.00 ${amt}`

describe("parseAdvice", () => {
	const text = `Banco Santander PR
Fecha: Oct. 01, 2026
Referencia 5440033483
${ROW(3423, 18, "$605.11")}
${ROW(3424, 19, "$1,200.00")}
${ROW(3437, 32, "$100.00")}
Total $1,905.11`

	it("reads the header", () => {
		const r = parseAdvice(text)
		expect(r.adviceDate).toBe("2026-10-01")
		expect(r.bank).toBe("Banco Santander PR")
		expect(r.reference).toBe("5440033483")
		expect(r.total).toBe(1905.11)
	})

	it("reads every row, invoice dates day-first (Jul 3, not Mar 7)", () => {
		const r = parseAdvice(text)
		expect(r.rows).toHaveLength(3)
		expect(r.rows[0]).toMatchObject({
			invoiceRef: "M19-3423",
			voucher: "5920050318",
			invoiceDate: "2026-07-03",
			amount: 605.11,
			withholding: 0,
			discount: 0,
			net: 605.11,
		})
		expect(r.rows[1].net).toBe(1200)
	})

	it("reads rows laid out one cell per line", () => {
		const cells = text.replace(/ /g, "\n")
		const r = parseAdvice(cells)
		expect(r.rows).toHaveLength(3)
		expect(r.rows[2].invoiceRef).toBe("M19-3437")
		expect(r.total).toBe(1905.11)
	})

	it("takes net as the last of four amounts and handles M193423 without a dash", () => {
		const r = parseAdvice(
			"01.10.2026\nM193423 5920050318 03.07.2026 $100.00 $10.00 $0.00 $90.00\nTotal $90.00",
		)
		expect(r.rows[0]).toMatchObject({
			invoiceRef: "M19-3423",
			amount: 100,
			withholding: 10,
			net: 90,
		})
		expect(r.adviceDate).toBe("2026-10-01")
	})

	it("returns no rows for text without invoices", () => {
		expect(parseAdvice("nothing here").rows).toEqual([])
	})
})

describe("parseAdvice on a page-broken advice with a second series", () => {
	const text = `PAYMENT ADVICE
Invoice # Voucher ID Invoice Date Amount Withholding Discount Net amount
M19-2949 5920039203 03.06.2026 14.58 (0.00) 0.00 14.58
M19-2902 5920038507 03.06.2026 20.48 (0.00) 0.00 20.48
Agosto 28, 2026
Bank: BANCO SANTANDER PUERTO
RICO
Bank ID: 021502341
Reference: 5440019914
M19-2950 5920039204 Junio 03, 106.42 (0.00) 0.00 106.42
JA-1616276 5920042289 03.06.2026 1,399.06 (0.00) 0.00 1,399.06
Agosto 28, 2026
Bank: BANCO SANTANDER
Reference: 5440019914
Total 1,540.54 (0.00 ) 0.00 1,540.54`

	it("takes the header from where the page breaks print it, Spanish month included", () => {
		const r = parseAdvice(text)
		expect(r.adviceDate).toBe("2026-08-28")
		expect(r.bank).toBe("BANCO SANTANDER PUERTO RICO")
		expect(r.reference).toBe("5440019914")
		expect(r.total).toBe(1540.54)
	})

	it("keeps the other series as rows so the rows add up to the printed total", () => {
		const r = parseAdvice(text)
		expect(r.rows.map((x) => x.invoiceRef)).toEqual([
			"M19-2949",
			"M19-2902",
			"M19-2950",
			"JA1616276",
		])
		expect(r.rows[3].net).toBe(1399.06)
		expect(r.rows.reduce((s, x) => s + x.net, 0)).toBeCloseTo(1540.54, 2)
		// A split date ("Junio 03,") has no year to read: the row keeps its amount.
		expect(r.rows[2]).toMatchObject({ invoiceDate: null, net: 106.42 })
	})
})

describe("parseAdvice JA refs", () => {
	it.each(["JA1616328", "JA-1616328", "JA 1616328", "ja-1616328"])(
		"reads %s as JA1616328",
		(ref) => {
			const r = parseAdvice(
				`Oct. 09, 2026\n${ref} 5920042289 03.06.2026 5,066.41 (0.00) 0.00 5,066.41\nTotal 5,066.41`,
			)
			expect(r.rows).toHaveLength(1)
			expect(r.rows[0]).toMatchObject({ invoiceRef: "JA1616328", net: 5066.41 })
		},
	)
})
