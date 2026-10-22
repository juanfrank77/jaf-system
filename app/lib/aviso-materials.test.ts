import { describe, expect, it } from "vitest"
import { compareMaterials, parseAvisoMaterials } from "./aviso-materials"

const HEAD =
	"MATERIALES USADOS TOTALES\nNUMERO DE MATERIAL DESCRIPCION CUENTA CANTIDAD INICIAL CANTIDAD USADA DEVOLVER\n"
const END = "Comentarios\n"
const known = new Set(["4003587", "4003588"])

describe("parseAvisoMaterials", () => {
	it("reads the explicit empty table as []", () => {
		expect(
			parseAvisoMaterials(`${HEAD}No items to show...\n${END}`, known),
		).toEqual([])
	})
	it("reads rows (used = middle integer)", () => {
		expect(
			parseAvisoMaterials(
				`${HEAD}4003587 POSTE 30' 6152X 3 2 1\n${END}`,
				known,
			),
		).toEqual([{ claroCode: "4003587", used: 2 }])
	})
	it("returns null for a duplicated code", () => {
		expect(
			parseAvisoMaterials(
				`${HEAD}4003587 POSTE 6152X 3 2 1\n4003587 POSTE 6152X 3 1 2\n${END}`,
				known,
			),
		).toBeNull()
	})
	it("returns null for a code not in the catalog", () => {
		expect(
			parseAvisoMaterials(`${HEAD}4D03S87 POSTE 6152X 3 2 1\n${END}`, known),
		).toBeNull()
	})
	it("returns null for a non-integer quantity", () => {
		expect(
			parseAvisoMaterials(`${HEAD}4003587 POSTE 6152X 3 2.5 1\n${END}`, known),
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

/*
 * Fixtures below are the text layer of real Claro prints as unpdf extracts it
 * (mergePages), kept as strings: the PDFs sit under the gitignored docs/.
 */
// "1.  AVISO 739.pdf": the empty table, then an icon glyph, the timestamp of
// the next block and "Comentarios".
const SAMPLE_739 =
	"MATERIALES USADOS TOTALESMATERIALES USADOS TOTALES\nNUMERO DE MATERIAL DESCRIPCION CUENTA CANTIDAD INICIAL CANTIDAD\nUSADA DEVOLVER\nNo items to show...\n\uf107\nAug 17, 2026 09:10 AM\nComentarios\nJOSSEAN J. LOPEZ GONZALEZ\n"
// The section and header lines of a clean print.
const TABLE =
	"MATERIALES USADOS TOTALESMATERIALES USADOS TOTALES\nNUMERO DE MATERIAL DESCRIPCION CUENTA CANTIDAD INICIAL CANTIDAD\nUSADA DEVOLVER\n"
const TAIL = "Aug 17, 2026 09:10 AM\nComentarios\nJOSSEAN J. LOPEZ GONZALEZ\n"
const catalog = new Set(["1005839", "1005840", "1005845", "1003737", "4003382"])

describe("parseAvisoMaterials on real print text (strict: unsure -> null)", () => {
	it("reads the 739 sample's empty table as []", () => {
		expect(parseAvisoMaterials(SAMPLE_739, catalog)).toEqual([])
	})

	it("reads well-formed rows up to Comentarios", () => {
		expect(
			parseAvisoMaterials(
				`${TABLE}1005840 POLE TAG 1 1 0\n1003737 Bolt Double Arming 5/8" X 14" J-8864 8 8 0\n${TAIL}`,
				catalog,
			),
		).toEqual([
			{ claroCode: "1005840", used: 1 },
			{ claroCode: "1003737", used: 8 },
		])
	})

	it("returns null for an OCR-garbled row among good ones (10341131)", () => {
		expect(
			parseAvisoMaterials(
				`${TABLE}0 i1005S30 ALUMINUM NAIL 2" 1 1\n1005840 POLE TAG 1 1 0\n${TAIL}`,
				catalog,
			),
		).toBeNull()
		expect(
			parseAvisoMaterials(
				`${TABLE}1005839. ALUMINUM NAIL 1 1 0\n1005840 POLE TAG 1 1 0\n${TAIL}`,
				catalog,
			),
		).toBeNull()
	})

	it("returns null for the whole 10341131 OCR text", () => {
		const ocr =
			'MATERIALES USADOS TOTALES\nNlJMkRO DE MAITRIAU OtSCRlPClON CUENTA C.ANTIDAO INICIAL CANODAD\nUSAOA W-VOlVEfi , ^\nS 5\n0 i1005S30 ALUMINUM NAIL 2" 1 1\n1005840 POLE TAG 1 1 0 ;\'\n1005845 STRANOVISeiOM 3/8\' 15 15 0\n4003382 WOODEN POLE 30 FT. CLASS 5 1 1 0\n4003382 JUNK-WOODEN POLE 30 FT. CLASS S 2\ni . Ciaro 7013\n0 2\n1003737 Bolt Double Arnimg 5/8" X 14" J -6854 8 8 0\nComcntarios e HIatona V\n'
		expect(parseAvisoMaterials(ocr, catalog)).toBeNull()
	})

	it("keeps reading across a page break (footer and page chrome skipped)", () => {
		expect(
			parseAvisoMaterials(
				`${TABLE}1005839 ALUMINUM NAIL 2" 1 1 0\nTodos los derechos reservados. Claro 2019\nIncidencias Mesa de Control Informes LUIS RIVERA 2\uf007 \uf011\n4/17/26, 9:50 AM NoticeProcessFlow2\nhttps://claropr.outsystemsenterprise.com/ManejoIncidentesWeb/NoticeProcessFlow1.aspx?NoticeId=12472\n1005840 POLE TAG 1 1 0\n${TAIL}`,
				catalog,
			),
		).toEqual([
			{ claroCode: "1005839", used: 1 },
			{ claroCode: "1005840", used: 1 },
		])
	})

	it("returns null when the quantities wrap to the next line", () => {
		expect(
			parseAvisoMaterials(
				`${TABLE}1005845 STRANDVISE 1 3 8\n2 2 0\n1005840 POLE TAG 1 1 0\n${TAIL}`,
				catalog,
			),
		).toBeNull()
	})

	it("returns null when a description ends in a number (ambiguous columns)", () => {
		expect(
			parseAvisoMaterials(
				`${TABLE}4003382 WOODEN POLE 30 FT. CLASS 5 1 1 0\n${TAIL}`,
				catalog,
			),
		).toBeNull()
	})

	it("returns null when initial != used + return", () => {
		expect(
			parseAvisoMaterials(`${TABLE}1005840 POLE TAG 3 1 1\n${TAIL}`, catalog),
		).toBeNull()
	})

	it("returns null for the empty marker with other content", () => {
		expect(
			parseAvisoMaterials(
				`${TABLE}No items to show...\n1005840 POLE TAG 1 1 0\n${TAIL}`,
				catalog,
			),
		).toBeNull()
		expect(
			parseAvisoMaterials(`${TABLE}No items to show...\nS 5\n${TAIL}`, catalog),
		).toBeNull()
	})

	it("returns null without the Comentarios terminator", () => {
		expect(
			parseAvisoMaterials(`${TABLE}1005840 POLE TAG 1 1 0\n`, catalog),
		).toBeNull()
		expect(
			parseAvisoMaterials(`${TABLE}No items to show...\n`, catalog),
		).toBeNull()
	})

	it("returns null for a stray line inside the table", () => {
		expect(
			parseAvisoMaterials(
				`${TABLE}1005840 POLE TAG 1 1 0\nS 5\n${TAIL}`,
				catalog,
			),
		).toBeNull()
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
