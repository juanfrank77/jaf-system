import { describe, expect, it } from "vitest"
import {
	type BankInvoiceInput,
	generateBankInvoicePdf,
} from "./bank-invoice.server"

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
	})
})
