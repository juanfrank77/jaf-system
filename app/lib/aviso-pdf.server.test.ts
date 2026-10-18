import { describe, expect, it } from "vitest"
import {
	AvisoPdfError,
	normaliseAvisoNumber,
	parseAvisoText,
	readAvisoPdf,
} from "./aviso-pdf.server"

// Mirrors the text layer of a real Claro Aviso print (synthetic values).
const header = (n: string) =>
	`Aviso #${n}Aviso #${n}\nCancelar Aviso Estado Actual: OnField Sometido\n${n}\nBo. Test\n`
const services = (rows: string) =>
	`Comentarios e Historia\nSERVICIOS REALIZADOS TOTALESSERVICIOS REALIZADOS TOTALES\nITEM CUENTA NOMBRE DESCRIPCION CANTIDAD\nINICIAL\nCANTIDAD\nUSADA DIFERENCIA HORAS\n${rows}MATERIALES USADOS TOTALESMATERIALES USADOS TOTALES\nNo items to show...\n`
const row = (code: string, initial: number, used: number) =>
	`${code} 6152X 6152X REMOCION\nBAJANTE GPON\nMantenimiento Regular\nprecios nuevos 2023\n${initial} ${used} ${initial - used} 0\n`

describe("parseAvisoText", () => {
	it("reads the Aviso number and each service row (used quantity)", () => {
		const parsed = parseAvisoText([
			header("10350001"),
			services(row("34012039", 1, 1) + row("34012040", 3, 2)),
		])
		expect(parsed.avisoNumber).toBe("10350001")
		expect(parsed.rows).toEqual([
			{ claroCode: "34012039", qtyInitial: 1, qtyUsed: 1 },
			{ claroCode: "34012040", qtyInitial: 3, qtyUsed: 2 },
		])
	})

	it("rejects two distinct Aviso numbers", () => {
		expect(() =>
			parseAvisoText([
				header("10350001"),
				header("10350002") + services(row("34012039", 1, 1)),
			]),
		).toThrowError(expect.objectContaining({ code: "multiple_numbers" }))
	})

	it("rejects a document with no Aviso number", () => {
		expect(() =>
			parseAvisoText([services(row("34012039", 1, 1))]),
		).toThrowError(expect.objectContaining({ code: "no_number" }))
	})

	it("rejects a document with no service rows", () => {
		expect(() =>
			parseAvisoText([header("10350001"), services("")]),
		).toThrowError(expect.objectContaining({ code: "no_rows" }))
	})

	it("ignores material rows after the services section", () => {
		const text = services(row("34012039", 1, 1)) + "34099999 1 1 0\n"
		expect(parseAvisoText([header("10350001"), text]).rows).toHaveLength(1)
	})
})

describe("normaliseAvisoNumber", () => {
	it("keeps digits only", () => {
		expect(normaliseAvisoNumber(" #1035 0001 ")).toBe("10350001")
	})
})

describe("readAvisoPdf", () => {
	it("reports garbage bytes as unreadable", async () => {
		const err = await readAvisoPdf(new Uint8Array([1, 2, 3])).catch((e) => e)
		expect(err).toBeInstanceOf(AvisoPdfError)
		expect(err.code).toBe("unreadable")
	})
})
