import { describe, expect, it } from "vitest"
import { parseEwitLiquidation } from "./ewit-parse"

const PAGE_1 = `Electronic Wireline Installation Tracking System
LIQUIDACION DETALLADA
JAF Communications Inc
Num. Contrato: 06-221
Num. Vendor: 400000077
Preparado por: ______ Fecha:______
Aprobado por: ______ Fecha:______
Num. Liquidación JA-16-16328 SAP PO Num null Fecha: 07/06/2026 Periodo: 06/22/2026 - 06/28/2026
Tarea Descripcion Cantidad Precio Unitario Importe Presupuesto
16-189-G Tree Trimming GPON 27 $1.76 $47.52 RF-PR020K260001-01-5163C
16-196-G Instalacion Modem GPON 12 $13.57 $162.84 RF-PR020K260001-01-5163C
Fecha de impresión: 07/07/2026 Página: 1`

const PAGE_2 = `Num. Liquidación JA-16-16328 SAP PO Num null Fecha: 07/06/2026 Periodo: 06/22/2026 - 06/28/2026
16-261-G Aerial-Buried Regular Installation GPON 12 $70.95 $851.40 RF-PR020K260001-01-5163C
16-261-G Aerial-Buried Regular Installation GPON 22 $70.95 $1,560.90 RF-PR020K260001-02-5163C
Total: $2,622.66
Fecha de impresión: 07/07/2026 Página: 2`

describe("parseEwitLiquidation", () => {
	const r = parseEwitLiquidation(`${PAGE_1}\n${PAGE_2}`)

	it("reads the header", () => {
		expect(r.number).toBe("JA1616328")
		expect(r.invoiceDate).toBe("2026-07-06")
		expect(r.periodStart).toBe("2026-06-22")
		expect(r.periodEnd).toBe("2026-06-28")
	})

	it("takes the total from the last page and sums the rows", () => {
		expect(r.total).toBe(2622.66)
		expect(r.lineCount).toBe(4)
		expect(r.linesTotal).toBe(2622.66)
	})

	it("reads text laid out one cell per line", () => {
		const cells = parseEwitLiquidation(
			`${PAGE_1}\n${PAGE_2}`.replace(/ /g, "\n"),
		)
		expect(cells.number).toBe("JA1616328")
		expect(cells.total).toBe(2622.66)
	})

	it("returns nulls for text that is not an EWIT liquidation", () => {
		expect(parseEwitLiquidation("hello")).toMatchObject({
			number: null,
			invoiceDate: null,
			total: null,
			lineCount: 0,
		})
	})
})
