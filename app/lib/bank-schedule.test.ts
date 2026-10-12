import { describe, expect, it } from "vitest"
import {
	areaLetter,
	bankInvoiceNumber,
	contractLabel,
	jobKind,
	localityFromAddress,
	scheduleTotals,
} from "./bank-schedule"

describe("bank-schedule helpers", () => {
	it("areaLetter: first letter uppercased; blank/null → null", () => {
		expect(areaLetter("NORTE")).toBe("N")
		expect(areaLetter(" sur ")).toBe("S")
		expect(areaLetter("")).toBeNull()
		expect(areaLetter(null)).toBeNull()
		expect(areaLetter(undefined)).toBeNull()
	})

	it("bankInvoiceNumber joins prefix and aviso", () => {
		expect(bankInvoiceNumber("M17", "10354739")).toBe("M17-10354739")
	})

	it("contractLabel drops the leading M", () => {
		expect(contractLabel("M17")).toBe("17-xxx")
		expect(contractLabel("X9")).toBe("X9-xxx")
	})

	it("localityFromAddress takes the last comma segment without state/zip", () => {
		expect(
			localityFromAddress(
				"CAM 906 Int. Parcelas Nuevas, Com. Aguacate, Yabucoa PR 00767",
			),
		).toBe("Yabucoa")
		expect(localityFromAddress("Calle Luna 55")).toBe("Calle Luna 55")
		expect(localityFromAddress("")).toBe("")
	})

	it("jobKind maps INSTALL to instalacion and anything else to mantenimiento", () => {
		expect(jobKind("INSTALL")).toBe("INSTALACION")
		expect(jobKind("CONSTRUCTION")).toBe("CONSTRUCCION")
		expect(jobKind("MAINTENANCE")).toBe("MANTENIMIENTO")
		expect(jobKind("whatever")).toBe("MANTENIMIENTO")
	})

	it("scheduleTotals reproduces the bank sample (80% advance)", () => {
		const { total, advance } = scheduleTotals([65934.99], 0.8)
		expect(total).toBe(65934.99)
		expect(advance).toBe(52747.99)
	})

	it("scheduleTotals rounds to cents and handles empty", () => {
		expect(scheduleTotals([0.1, 0.2], 0.8)).toEqual({
			total: 0.3,
			advance: 0.24,
		})
		expect(scheduleTotals([], 0.8)).toEqual({ total: 0, advance: 0 })
	})
})
