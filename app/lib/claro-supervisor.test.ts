import { describe, expect, it } from "vitest"
import { validateClaroSupervisor } from "./claro-supervisor"

describe("validateClaroSupervisor", () => {
	it("rejects a blank name", () => {
		expect(
			validateClaroSupervisor({ name: "  ", email: "x@claro.com" }),
		).toEqual({ ok: false, errorKey: "claro_supervisors.errors.invalid_name" })
	})
	it("rejects a malformed email", () => {
		expect(
			validateClaroSupervisor({ name: "Ana", email: "not-an-email" }),
		).toEqual({ ok: false, errorKey: "claro_supervisors.errors.invalid_email" })
	})
	it("accepts a valid entry", () => {
		expect(
			validateClaroSupervisor({ name: "Ana", email: "x@claro.com" }),
		).toEqual({ ok: true })
	})
})
