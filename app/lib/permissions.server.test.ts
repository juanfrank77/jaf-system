import { describe, expect, it } from "vitest"
import { canTransition } from "./permissions"

const avisoCtx = {
	jafInvoiceLines: [
		{
			serviceCodeId: "c1",
			claroCode: "34006301",
			qty: 5,
			unitPrice: 42.343,
			lineAmount: 211.72,
		},
	],
	avisoLines: [
		{
			serviceCodeId: "c1",
			claroCode: "34006301",
			qty: 5,
			unitPrice: 42.343,
			lineAmount: 211.72,
		},
	],
	tolerance: 0.01,
}

describe("canTransition aviso guard (#28)", () => {
	it("blocks CLARO_UPLOADED without aviso context", () => {
		expect(
			canTransition("SUPERVISOR_APPROVED", "CLARO_UPLOADED", "SUPERVISOR"),
		).toBe(false)
	})

	it("allows CLARO_UPLOADED when amounts match", () => {
		expect(
			canTransition(
				"SUPERVISOR_APPROVED",
				"CLARO_UPLOADED",
				"SUPERVISOR",
				avisoCtx,
			),
		).toBe(true)
	})

	it("blocks CLARO_UPLOADED when amounts mismatch", () => {
		expect(
			canTransition("SUPERVISOR_APPROVED", "CLARO_UPLOADED", "SUPERVISOR", {
				...avisoCtx,
				avisoLines: [
					{
						serviceCodeId: "c1",
						claroCode: "34006301",
						qty: 5,
						unitPrice: 100,
						lineAmount: 500,
					},
				],
			}),
		).toBe(false)
	})

	it("blocks LC_REQUEST_GENERATED when amounts mismatch", () => {
		expect(
			canTransition("CLARO_UPLOADED", "LC_REQUEST_GENERATED", "FINANCE", {
				...avisoCtx,
				avisoLines: [
					{
						serviceCodeId: "c1",
						claroCode: "34006301",
						qty: 5,
						unitPrice: 100,
						lineAmount: 500,
					},
				],
			}),
		).toBe(false)
	})
})
