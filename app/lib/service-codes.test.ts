import { describe, expect, it } from "vitest"
import { resolveSerial } from "./service-codes"

const codes: { id: string; serialPrefix: string | null }[] = [
	{ id: "ont-1", serialPrefix: "ALCLED" },
	{ id: "stb-1", serialPrefix: "STBHW" },
]

describe("resolveSerial", () => {
	it("matches a serial to its SKU by prefix", () => {
		expect(resolveSerial("ALCLED1A5220", codes)?.id).toBe("ont-1")
	})
	it("returns null for an unknown prefix", () => {
		expect(resolveSerial("XYZ12345", codes)).toBeNull()
	})
})
