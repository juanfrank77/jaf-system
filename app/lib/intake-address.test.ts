import { describe, expect, it } from "vitest"
import { composeJobAddress, parseAddressInput } from "./intake-address"

function form(entries: Record<string, string>) {
	const f = new FormData()
	for (const [k, v] of Object.entries(entries)) f.set(k, v)
	return f
}
const valid = {
	direccion1: "119",
	tipo: "Aéreo",
	tipoPlanta: "GPON",
	grupoPlan: "G1",
}

describe("parseAddressInput", () => {
	it("accepts blank optional fields and trims", () => {
		const r = parseAddressInput(
			form({
				...valid,
				direccion1: " 119 ",
				sector: " ",
				direccion2: "",
				latitud: "",
				longitud: " ",
			}),
		)
		expect(r).toEqual({
			ok: true,
			value: {
				sector: null,
				direccion1: "119",
				direccion2: null,
				latitud: null,
				longitud: null,
				tipo: "Aéreo",
				ciudad: null,
				tipoPlanta: "GPON",
				grupoPlan: "G1",
			},
		})
	})
	it.each(["direccion1", "tipo", "tipoPlanta", "grupoPlan"])(
		"rejects whitespace-only %s",
		(key) => {
			expect(parseAddressInput(form({ ...valid, [key]: "   " }))).toEqual({
				ok: false,
				errorKey: "docs_new.errors.address_required",
			})
		},
	)
	it("rejects a missing required field", () => {
		const { tipo: _t, ...rest } = valid
		expect(parseAddressInput(form(rest)).ok).toBe(false)
	})
})

describe("composeJobAddress", () => {
	it("joins direccion1 and sector", () => {
		expect(
			composeJobAddress({ direccion1: "119", sector: "Sector Palomar" }),
		).toBe("119, Sector Palomar")
	})
	it("omits a null sector", () => {
		expect(composeJobAddress({ direccion1: "119", sector: null })).toBe("119")
	})
})
