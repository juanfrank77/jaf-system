import { describe, expect, it } from "vitest"
import { splitServiceSuffix } from "./service-lines"

describe("splitServiceSuffix", () => {
	it("splits a glued MC/MO off the last word", () => {
		expect(splitServiceSuffix("INST POSTE 30 C5MC")).toEqual({
			base: "INST POSTE 30 C5",
			suffix: "MC",
		})
		expect(splitServiceSuffix('INST "HAND HOLE" EN CONCRETOMO')).toEqual({
			base: 'INST "HAND HOLE" EN CONCRETO',
			suffix: "MO",
		})
	})
	it("leaves names without a glued suffix alone", () => {
		for (const n of ["TUBERIA PVC", "CABLE AEREO MO", "MO"])
			expect(splitServiceSuffix(n)).toEqual({ base: n, suffix: null })
	})
})
