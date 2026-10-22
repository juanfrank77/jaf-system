import { describe, expect, it } from "vitest"
import { compareMaterials, parseAvisoMaterials } from "./aviso-materials"

const HEAD =
	"MATERIALES USADOS TOTALES\nNUMERO DE MATERIAL DESCRIPCION CUENTA CANTIDAD INICIAL CANTIDAD USADA DEVOLVER\n"
const known = new Set(["4003587", "4003588"])

describe("parseAvisoMaterials", () => {
	it("reads the explicit empty table as []", () => {
		expect(parseAvisoMaterials(`${HEAD}No items to show...\n`, known)).toEqual(
			[],
		)
	})
	it("reads rows (used = middle integer)", () => {
		expect(
			parseAvisoMaterials(`${HEAD}4003587 POSTE 30' 6152X 3 2 1\n`, known),
		).toEqual([{ claroCode: "4003587", used: 2 }])
	})
	it("returns null for a duplicated code", () => {
		expect(
			parseAvisoMaterials(
				`${HEAD}4003587 POSTE 6152X 3 2 1\n4003587 POSTE 6152X 3 1 1\n`,
				known,
			),
		).toBeNull()
	})
	it("returns null for a code not in the catalog", () => {
		expect(
			parseAvisoMaterials(`${HEAD}4D03S87 POSTE 6152X 3 2 1\n`, known),
		).toBeNull()
	})
	it("returns null for a non-integer quantity", () => {
		expect(
			parseAvisoMaterials(`${HEAD}4003587 POSTE 6152X 3 2.5 1\n`, known),
		).toBeNull()
	})
	it("returns null without the section, and for empty text", () => {
		expect(parseAvisoMaterials("nothing here", known)).toBeNull()
		expect(parseAvisoMaterials("", known)).toBeNull()
	})
	it("returns null for a header with neither rows nor the empty marker", () => {
		expect(parseAvisoMaterials(HEAD, known)).toBeNull()
	})
})

describe("compareMaterials", () => {
	const wo = [{ claroCode: "A1", name: "Pole", used: 3 }]
	it("equal -> []", () => {
		expect(compareMaterials(wo, [{ claroCode: "A1", used: 3 }])).toEqual([])
	})
	it("differing qty", () => {
		expect(compareMaterials(wo, [{ claroCode: "A1", used: 2 }])).toEqual([
			{ claroCode: "A1", name: "Pole", workOrder: 3, aviso: 2 },
		])
	})
	it("WO line missing from Aviso -> aviso 0 (also when Aviso is [])", () => {
		expect(compareMaterials(wo, [])).toEqual([
			{ claroCode: "A1", name: "Pole", workOrder: 3, aviso: 0 },
		])
	})
	it("extra Aviso row -> workOrder 0, name falls back to code", () => {
		expect(
			compareMaterials(wo, [
				{ claroCode: "A1", used: 3 },
				{ claroCode: "B2", used: 1 },
			]),
		).toEqual([{ claroCode: "B2", name: "B2", workOrder: 0, aviso: 1 }])
	})
	it("both empty -> []", () => {
		expect(compareMaterials([], [])).toEqual([])
	})
	it("sorts by code", () => {
		const d = compareMaterials(
			[
				{ claroCode: "Z", name: "z", used: 1 },
				{ claroCode: "A", name: "a", used: 1 },
			],
			[],
		)
		expect(d.map((x) => x.claroCode)).toEqual(["A", "Z"])
	})
})
