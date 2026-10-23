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
