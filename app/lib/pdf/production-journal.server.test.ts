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

	it("prints 0.00 for JAF prices on the brigade copy, not blanks or the real gross", async () => {
		const blocks = buildJournalBlocks([
			invoice("i1", "MAINT261012032", "10354739", 731.4),
		])
		const text = await textOf(
			await generateProductionJournalPdf({ label: "run" }, blocks, {
				showPrices: false,
			}),
		)
		expect(text).not.toContain("731.40")
		expect(text).toMatch(/Totals 0\.00 475\.41/)
		// line, Sub Total and Total SC each print 0.00 for unit price/gross
		expect(text.match(/0\.00/g)?.length).toBeGreaterThanOrEqual(5)
	})

	it("adds up from the printed lines at every level", () => {
		const line = (gross: number) => ({
			claroCode: "1",
			name: "x",
			qty: 1,
			unitPrice: gross,
			gross,
			sharePercent: 0.65,
		})
		const job = (id: string, seq: number, code: string, grosses: number[]) => ({
			id,
			controlNumber: id,
			jobSeq: seq,
			avisoNumber: id,
			contractorAccount: { id: code, code, label: code },
			contractorShareLines: grosses.map(line),
		})
		const blocks = buildJournalBlocks([
			job("a", 2, "025", [731.4, 41.25, 6.2, 367.68]),
			job("b", 5, "025", [61.81, 952.2, 82.5, 12.4, 61.81, 367.68]),
			job("c", 1, "178", [500.31, 12.07]),
		])
		const cents = (n: number) => Math.round(n * 100)
		for (const b of blocks) {
			for (const j of b.jobs) {
				for (const l of j.lines) {
					expect(cents(l.adjNet)).toBe(cents(l.net) - cents(l.retention))
				}
				const sum = (f: (l: (typeof j.lines)[number]) => number) =>
					j.lines.reduce((s, l) => s + cents(f(l)), 0)
				expect(cents(j.net)).toBe(sum((l) => l.net))
				expect(cents(j.retention)).toBe(sum((l) => l.retention))
				expect(cents(j.adjNet)).toBe(sum((l) => l.adjNet))
			}
			const jobs = (f: (j: (typeof b.jobs)[number]) => number) =>
				b.jobs.reduce((s, j) => s + cents(f(j)), 0)
			expect(cents(b.net)).toBe(jobs((j) => j.net))
			expect(cents(b.retention)).toBe(jobs((j) => j.retention))
			expect(cents(b.totalSC)).toBe(jobs((j) => j.adjNet))
			expect(b.jobs.at(-1)?.adjNetRunning).toBe(b.totalSC)
		}
		// M-2 line 1 of the partner's example: 475.41 − 47.54 = 427.87
		expect(blocks[0].jobs[0].lines[0].adjNet).toBe(427.87)
	})

	it("prints Acct. ID, the request in every header and the grand total under the last brigade", async () => {
		const blocks = buildJournalBlocks([
			{
				...invoice("i1", "M-1", "10359201", 100),
				contractorAccount: {
					id: "a",
					code: "016",
					label: "Carlos Martínez",
					brigade: { code: "204" },
				},
			},
			{
				...invoice("i2", "M-2", "10359552", 200),
				contractorAccount: {
					id: "b",
					code: "011",
					label: "Fernando Rosario",
					brigade: null,
				},
			},
		])
		expect(blocks.find((b) => b.accountCode === "016")?.acctId).toBe("204")
		const bytes = await generateProductionJournalPdf(
			{ label: "PR0001 · 10/26/2026 – 11/08/2026" },
			blocks,
			{ showPrices: false, payDate: new Date("2026-11-13T16:00:00Z") },
		)
		// one page per brigade; the totals ride on the last one
		expect(await pagesOf(bytes)).toBe(2)
		const text = await textOf(bytes)
		expect(text.match(/PR0001 · 10\/26\/2026 – 11\/08\/2026/g)).toHaveLength(2)
		expect(text).toContain("Pay date 11/13/26")
		expect(text).toContain("Acct. ID: 204")
		expect(text).toContain("M-1 M17-10359201")
		expect(text).toContain("Totals")
		const outline = await journalOutline({ label: "run" }, blocks, {
			showPrices: false,
		})
		expect(outline.totalPages).toBe(2)
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
		// Each line is net − retention, truncated once; the running column only adds.
		// 928.88 → 603.77 − 60.37 = 543.40, then 0.68 → 0.44 − 0.04 = 0.40.
		expect(blocks[0].jobs[0].adjNetRunning).toBe(543.4)
		expect(blocks[0].jobs[1].adjNetRunning).toBe(543.8)
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
		expect(await pagesOf(whole)).toBe(2)
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
		expect(text).toContain("sent by Lissette 10/28/26 8:12 AM · page 1 of 2")
		expect(text).toContain("page 2 of 2")
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
		expect(outline.totalPages).toBe(2)
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
