import { describe, expect, it } from "vitest"
import { runPoChecks } from "./po-reading"
import { isSoundPoRead, type PdfText, parsePoText } from "./po-text-parse"

/** A PO laid out as Claro's system prints it (columns from real POs). */
const cell = (x: number, y: number, text: string, page = 1): PdfText => ({
	page,
	x,
	y,
	text,
})
const header = (extra: PdfText[] = []) => [
	cell(608, 566, "10337808"),
	cell(608, 531, "K010"),
	cell(608, 520, "VENCIMIENTO EN 60 DÍAS"),
	cell(64, 474, "4500518597"),
	cell(27, 440, "16.07.2026"),
	cell(117, 440, "1 de/of 4"),
	...extra,
]
const item = (
	y: number,
	no: string,
	description: string,
	amount: string,
	ivu: string,
	total: string,
) => [
	cell(13, y, no),
	cell(147, y, description),
	cell(376, y, "07"),
	cell(492, y, "1.00"),
	cell(648, y, amount),
	cell(695, y, "Subtotal"),
	cell(741, y, amount),
	cell(712, y - 11, "IVU"),
	cell(745, y - 11, ivu),
	cell(705, y - 22, "Total"),
	cell(741, y - 22, total),
]
const totals = (y: number, sub: string, ivu: string, total: string) => [
	cell(578, y, "Subtotal"),
	cell(734, y, sub),
	cell(578, y - 11, "Total IVU"),
	cell(739, y - 11, ivu),
	cell(578, y - 28, "Total USD"),
	cell(727, y - 28, total),
]
// Sample from PO 4500518597 / M19-3635: one line at 4%, one at 11.5%.
const mixed = [
	...header(),
	...item(365, "00010", "600XREMOCION# POSTES#", "103.95", "4.16", "108.11"),
	...item(
		320,
		"00020",
		"Incentico Atender Emergencias",
		"200.00",
		"23.00",
		"223.00",
	),
	...totals(280, "303.95", "27.16", "331.11"),
]

describe("parsePoText", () => {
	it("reads the header, every line and the IVU per line", () => {
		expect(parsePoText(mixed)).toEqual({
			poNumber: "4500518597",
			poDate: "2026-07-16",
			statedPages: 4,
			termsDays: 60,
			avisoCandidates: ["10337808"],
			lines: [
				{
					item: "00010",
					description: "600XREMOCION# POSTES#",
					amount: 103.95,
					ivuRate: 0.04,
					ivu: 4.16,
				},
				{
					item: "00020",
					description: "Incentico Atender Emergencias",
					amount: 200,
					ivuRate: 0.115,
					ivu: 23,
				},
			],
			subtotal: 303.95,
			ivu4: 4.16,
			ivu115: 23,
			total: 331.11,
		})
	})

	it("passes every check, so the PO can be confirmed in one click", () => {
		expect(
			runPoChecks(parsePoText(mixed), {
				filePages: 4,
				duplicate: false,
				billedPreIvu: null,
				alreadyPod: 0,
			}),
		).toEqual([])
	})

	it("keeps description text on the rows under the item, and does not take the PO's totals as a line", () => {
		const r = parsePoText([
			...header(),
			...item(
				365,
				"00010",
				"Mantenimiento Regular",
				"505.00",
				"20.20",
				"525.20",
			),
			cell(147, 353, "10 34012033 6152C INSTAL BRANCH"),
			...totals(290, "505.00", "20.20", "525.20"),
		])
		expect(r.lines).toHaveLength(1)
		expect(r.lines[0].description).toBe(
			"Mantenimiento Regular 10 34012033 6152C INSTAL BRANCH",
		)
		expect(r.subtotal).toBe(505)
	})

	it("reads the terms from Claro's code when the words are missing", () => {
		const r = parsePoText(
			mixed.filter((c) => !c.text.startsWith("VENCIMIENTO")),
		)
		expect(r.termsDays).toBe(60)
	})

	it("finds the Aviso in the notes when the box has none", () => {
		const r = parsePoText([
			...mixed.filter((c) => c.text !== "10337808"),
			cell(5, 516, "10340294", 2),
		])
		expect(r.avisoCandidates).toEqual(["10340294"])
	})
})

describe("isSoundPoRead", () => {
	it("trusts a printed PO whose lines add up", () => {
		expect(isSoundPoRead(parsePoText(mixed))).toBe(true)
	})
	it("does not trust a scan's OCR layer: no lines, or figures that do not add up", () => {
		expect(isSoundPoRead(parsePoText([]))).toBe(false)
		const misread = parsePoText(mixed)
		misread.subtotal = 383.95
		expect(isSoundPoRead(misread)).toBe(false)
	})
})
