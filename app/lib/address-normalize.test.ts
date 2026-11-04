import { describe, expect, it } from "vitest"
import { canonicalize, normalizeKey } from "./address-normalize"

describe("normalizeKey", () => {
	it("folds accents, case and surrounding whitespace", () => {
		expect(normalizeKey("Aéreo")).toBe("aereo")
		expect(normalizeKey("aereo ")).toBe("aereo")
		expect(normalizeKey("  AEREO  ")).toBe("aereo")
	})
	it("collapses inner whitespace", () => {
		expect(normalizeKey("GPON  x")).toBe("gpon x")
	})
})

describe("canonicalize", () => {
	it("returns the existing entry with the same key", () => {
		expect(canonicalize("aereo ", ["Aéreo"])).toBe("Aéreo")
	})
	it("trims and collapses whitespace when nothing matches", () => {
		expect(canonicalize("  Sub  terráneo ", [])).toBe("Sub terráneo")
	})
})
