import { extractText, getDocumentProxy } from "unpdf"
import { describe, expect, it } from "vitest"
import { buildJournalBlocks } from "~/lib/payroll-run.server"
import {
	generatePacketSummaryPdf,
	generateProductionJournalPdf,
	journalOutline,
} from "~/lib/pdf/production-journal.server"

const textOf = async (bytes: Buffer) =>
	(
		await extractText(await getDocumentProxy(new Uint8Array(bytes)), {
			mergePages: true,
		})
	).text
const pagesOf = async (bytes: Buffer) =>
	(await getDocumentProxy(new Uint8Array(bytes))).numPages
const twoBrigades = () =>
	buildJournalBlocks([
		invoice("i1", "MAINT-A", "111", 100),
		{
			...invoice("i2", "MAINT-B", "222", 200),
			contractorAccount: { id: "b", code: "011", label: "Fernando Rosario" },
		},
	])

const invoice = (
	id: string,
	control: string,
	aviso: string,
	gross: number,
) => ({
	id,
	controlNumber: control,
	avisoNumber: aviso,
	contractorAccount: { id: "a", code: "016", label: "Carlos Martínez" },
	contractorShareLines: [
		{
			claroCode: "34012039",
			name: "REMOCION BAJANTE",
			qty: 1,
			unitPrice: gross,
			gross,
			sharePercent: 0.65,
			net: 0,
			retention: 0,
			adjNet: 0,
		},
	],
})

describe("generateProductionJournalPdf", () => {
	it("renders the journal with prices (Lissette's copy)", async () => {
		const blocks = buildJournalBlocks([
			invoice("i1", "MAINT261012032", "10354739", 118.45),
		])
		const bytes = await generateProductionJournalPdf({ label: "run" }, blocks, {
			showPrices: true,
		})
		expect(bytes.subarray(0, 4).toString()).toBe("%PDF")
	})

	it("renders the brigade copy without prices", async () => {
		const blocks = buildJournalBlocks([
			invoice("i1", "MAINT261012032", "10354739", 118.45),
		])
		const bytes = await generateProductionJournalPdf({ label: "run" }, blocks, {
			showPrices: false,
		})
		expect(bytes.subarray(0, 4).toString()).toBe("%PDF")
	})

	it("renders a request with no brigades without throwing", async () => {
		const bytes = await generateProductionJournalPdf({ label: "empty" }, [], {
			showPrices: false,
		})
		expect(bytes.subarray(0, 4).toString()).toBe("%PDF")
	})

	it("orders jobs by their M-number, ascending", () => {
		const blocks = buildJournalBlocks([
			{ ...invoice("i1", "MAINT-B", "1", 10), jobSeq: 3546 },
			{ ...invoice("i2", "MAINT-A", "2", 10), jobSeq: 3545 },
			invoice("i3", "MAINT-C", "3", 10),
		])
		expect(blocks[0].jobs.map((j) => j.controlNumber)).toEqual([
			"MAINT-A",
			"MAINT-B",
			"MAINT-C",
		])
	})

	it("running Adj. Net is figured on the brigade's gross so far", () => {
		const blocks = buildJournalBlocks([
			invoice("i1", "M-1", "1", 928.88),
			invoice("i2", "M-2", "2", 0.68),
		])
		// floor(92888 × 0.585) = 543.39, then floor(92956 × 0.585) = 543.79
		expect(blocks[0].jobs[0].adjNetRunning).toBe(543.39)
		expect(blocks[0].jobs[1].adjNetRunning).toBe(543.79)
	})

	it("prints only the picked brigades and no report totals page", async () => {
		const blocks = twoBrigades()
		const run = { label: "run" }
		const whole = await generateProductionJournalPdf(run, blocks, {
			showPrices: false,
		})
		const one = await generateProductionJournalPdf(run, blocks, {
			showPrices: false,
			onlyBrigades: ["011"],
		})
		expect(await pagesOf(whole)).toBe(3)
		expect(await pagesOf(one)).toBe(1)
		const text = await textOf(one)
		expect(text).toContain("FERNANDO ROSARIO")
		expect(text).not.toContain("CARLOS")
	})

	it("puts Carmen's footer with page x of y on every page", async () => {
		const bytes = await generateProductionJournalPdf(
			{ label: "run" },
			twoBrigades(),
			{
				showPrices: false,
				footer: "Carmen's copy · sent by Lissette 10/28/26 8:12 AM",
			},
		)
		const text = await textOf(bytes)
		expect(text).toContain("sent by Lissette 10/28/26 8:12 AM · page 1 of 3")
		expect(text).toContain("page 3 of 3")
	})

	it("says where each brigade starts, then the totals page follows", async () => {
		const outline = await journalOutline({ label: "run" }, twoBrigades(), {
			showPrices: false,
		})
		expect(outline.brigades.map((b) => [b.code, b.startPage, b.pages])).toEqual(
			[
				["011", 1, 1],
				["016", 2, 1],
			],
		)
		expect(outline.totalPages).toBe(3)
	})

	it("makes a one-page brigade list with the page each starts on", async () => {
		const run = { label: "10/12/2026 – 10/25/2026" }
		const outline = await journalOutline(run, twoBrigades(), {
			showPrices: false,
		})
		const bytes = await generatePacketSummaryPdf(run, outline, {})
		expect(await pagesOf(bytes)).toBe(1)
		const text = await textOf(bytes)
		expect(text).toContain("PAYROLL PACKET SUMMARY")
		expect(text).toContain("FERNANDO ROSARIO")
		expect(text).toContain("CARLOS")
	})
})
