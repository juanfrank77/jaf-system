import { describe, expect, it } from "vitest"
import { avisoPdfUrl, hasAvisoPdf } from "./aviso-document"

describe("hasAvisoPdf", () => {
	it("is true for the step-6 Aviso PDF alone", () => {
		expect(hasAvisoPdf({ avisoDocPath: "aviso-docs/j-aviso.pdf" })).toBe(true)
	})

	it("falls back to the legacy Claro work-order PDF", () => {
		expect(
			hasAvisoPdf({ avisoDocPath: null, claroPdfPath: "claro-pdfs/j.pdf" }),
		).toBe(true)
	})

	it("is false when neither field holds a path", () => {
		expect(hasAvisoPdf({ avisoDocPath: null, claroPdfPath: null })).toBe(false)
		expect(hasAvisoPdf({ avisoDocPath: "  ", claroPdfPath: "" })).toBe(false)
		expect(hasAvisoPdf({})).toBe(false)
	})
})

describe("avisoPdfUrl", () => {
	it("prefers the Aviso PDF over the legacy one", () => {
		expect(
			avisoPdfUrl({ id: "j1", avisoDocPath: "x", claroPdfPath: "y" }),
		).toBe("/files/aviso-docs/j1-aviso.pdf")
	})

	it("uses the legacy PDF when it is the only one, and null when none", () => {
		expect(avisoPdfUrl({ id: "j1", claroPdfPath: "y" })).toBe(
			"/files/claro-pdfs/j1-claro.pdf",
		)
		expect(avisoPdfUrl({ id: "j1" })).toBeNull()
	})
})
