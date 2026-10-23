import { describe, expect, it } from "vitest"
import { parseOcrPasses } from "./po-ocr-parse"
import { runPoChecks } from "./po-reading"

// Real Tesseract output for Kay's sample PO 4500510139 (one poor scan, read three ways).
const BIN_PSM6 = `VENDOR CODE   .     .        400000077        SHIP VIA     Cs          CONDITIONS,
    66-0564397                               HAY Sk Beale Bese i eos   10333185
4500510139      ]      EE EA 0000 | MACEN: ENTREGAR BIENES A             so      ———
14.05.2026         © 1defof4          DOCUMENTOS Y EMPAQUES.                                    £.0. Box 11205
80610           190000         Mantenimicnto Regular                                                       1.60 | SERVICE /SERVICIO                403.28      Subtotal     403.28]
10 34005457 8002C INST POSTE 30 C5 MC 2 SRY 201.93 USD                                        :                                        wy     1615
RF-PRO22F260021-05-6062C 403.86 0                                                        .                                               Total     420.01
20                              0.06 USD 0.00
Subtotal                         403.86
                                                                               Total VU                          16.15
Total USD                        420.01`
const BIN_PSM11 = `400000077
10333185
66-0554397
"4500510139
14.05.2026
Subtotal
403.26]
16.15
10 34005457 6002C INST POSTE 30 C5 MC 2 SRY 201.93 USD
RF-PR0O22F260021-05-6002C 403.86 0
Total
420.01
Subtotal
403.86
Total iVU
16.15
420.01
Total USD`
const RAW_PSM11 = `4060000077
10333185
GABIA, SANTA ISABEL 85510120260193
_ 450051 0139
14.05.2026
Subtotal 403.86]
10 84005457 6002C INST POSTE 30 C5 MC 2 SRY 201.93 USD
RF-PR022F260021-05-6002C 403.86 0
Subtotal 403.86
Total iVU 16.15
Total USD 420.01
CONDICIONES DE PAGO K010 VENCIMIENTO EN 60 Diag`

describe("parseOcrPasses", () => {
	const read = parseOcrPasses([BIN_PSM6, BIN_PSM11, RAW_PSM11])

	it("reads the header fields despite spaces and noise", () => {
		expect(read.poNumber).toBe("4500510139")
		expect(read.poDate).toBe("2026-05-14")
		expect(read.statedPages).toBe(4)
		expect(read.termsDays).toBe(60)
		expect(read.avisoCandidates[0]).toBe("10333185")
	})

	it("picks the totals that add up over a misread digit", () => {
		expect(read.subtotal).toBe(403.86)
		expect(read.total).toBe(420.01)
		expect(read.ivu4).toBe(16.15)
		expect(read.ivu115).toBe(0)
	})

	it("builds the line from quantity x price and finds its 4% rate", () => {
		expect(read.lines).toHaveLength(1)
		expect(read.lines[0]).toMatchObject({
			amount: 403.86,
			ivuRate: 0.04,
			ivu: 16.15,
		})
	})

	it("passes every check on this PO", () => {
		expect(
			runPoChecks(read, {
				filePages: 4,
				duplicate: false,
				billedPreIvu: 500,
				alreadyPod: 0,
			}),
		).toEqual([])
	})

	it("returns empty fields, not a crash, for text with nothing in it", () => {
		const r = parseOcrPasses(["", "garbage"])
		expect(r.poNumber).toBeNull()
		expect(r.lines).toEqual([])
		expect(r.subtotal).toBeNull()
	})

	it("splits mixed 4% and 11.5% lines", () => {
		const text = `4500526054 04.09.2026 1 de 1
10 34005457 A 1 SRV 224.25 USD
20 34005458 B 1 SRV 592.78 USD
Subtotal 817.03
Total IVU 77.14
Total USD 894.17`
		const r = parseOcrPasses([text])
		expect(r.lines.map((l) => l.ivuRate)).toEqual([0.04, 0.115])
		expect(r.ivu4).toBe(8.97)
		expect(r.ivu115).toBe(68.17)
	})
})
