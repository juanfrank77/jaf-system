import { describe, expect, it } from "vitest"
import {
	acOf,
	areaLetter,
	BANK_INVOICE_PREFIX,
	bankInvoiceNumber,
	barrioFromAddress,
	contractLabel,
	localityFromAddress,
	parsePbccEmails,
	resumenGroups,
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
		expect(localityFromAddress("Calle X, Yabucoa, PR 00767")).toBe("Yabucoa")
		expect(localityFromAddress("Calle X, Yabucoa PR")).toBe("Yabucoa")
		expect(localityFromAddress("Calle X, Yabucoa,")).toBe("Yabucoa")
		expect(localityFromAddress("Calle X, Yabucoa, PR")).toBe("Yabucoa")
	})

	it("barrioFromAddress takes the first comma segment, blank for a single segment", () => {
		expect(
			barrioFromAddress(
				"CAM 906 Int. Parcelas Nuevas, Com. Aguacate, Yabucoa PR 00767",
			),
		).toBe("CAM 906 Int. Parcelas Nuevas")
		expect(barrioFromAddress("BO TIERRAS NUEVAS, MANATI, PR 00674")).toBe(
			"BO TIERRAS NUEVAS",
		)
		expect(barrioFromAddress("Calle Luna 55, Mayagüez PR 00680")).toBe(
			"Calle Luna 55",
		)
		expect(barrioFromAddress("Calle Luna 55")).toBe("")
		expect(barrioFromAddress("Yabucoa PR 00767")).toBe("")
		expect(barrioFromAddress("")).toBe("")
	})

	it("parsePbccEmails takes one or several addresses, however they are separated", () => {
		expect(parsePbccEmails("a@pbcc.com")).toEqual(["a@pbcc.com"])
		expect(
			parsePbccEmails("a@pbcc.com, b@pbcc.com; c@pbcc.com\nd@pbcc.com"),
		).toEqual(["a@pbcc.com", "b@pbcc.com", "c@pbcc.com", "d@pbcc.com"])
		expect(parsePbccEmails("  ")).toEqual([])
		expect(parsePbccEmails("a@pbcc.com, nope")).toBeNull()
	})

	it("the M17 prefix is fixed", () => {
		expect(BANK_INVOICE_PREFIX).toBe("M17")
	})

	it("A/C is the first three digits of the catalog's account code", () => {
		expect(acOf("610")).toBe("610")
		expect(acOf("6102")).toBe("610")
		expect(acOf(null)).toBe("")
	})

	it("Resumen groups the lines of sample M17-10353721 by A/C and ACT, each with its total", () => {
		// The eleven lines of the sample, A/C and ACT as printed on it.
		const lines = [
			["610", "2", 220.96],
			["600", "X", 16.23],
			["630", "2", 1238.16],
			["610", "2", 54.88],
			["610", "X", 61.2],
			["610", "X", 41.67],
			["600", "X", 623.7],
			["600", "C", 403.86],
			["610", "M", 338.72],
			["610", "X", 243],
			["610", "C", 25.66],
		].map(([accountCode, act, amount]) => ({
			accountCode,
			act,
			amount,
		})) as { accountCode: string; act: string; amount: number }[]
		const groups = resumenGroups(lines)
		expect(groups).toEqual([
			{ label: "600- - -C", total: 403.86 },
			{ label: "600- - -X", total: 639.93 },
			{ label: "610- - -2", total: 275.84 },
			{ label: "610- - -C", total: 25.66 },
			{ label: "610- - -M", total: 338.72 },
			{ label: "610- - -X", total: 345.87 },
			{ label: "630- - -2", total: 1238.16 },
		])
		expect(groups.reduce((s, g) => s + g.total, 0)).toBeCloseTo(3268.04, 2)
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
