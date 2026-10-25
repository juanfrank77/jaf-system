import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { BatchView } from "~/lib/pbcc-batch-view"
import { type BatchCheckView, PbccBatchDetailView } from "./pbcc-batch-detail"
import { PbccBatchListView, PbccBatchOpenView } from "./pbcc-batch-open"

const row = (n: number, over: Partial<BatchView["rows"][number]> = {}) => ({
	id: `j${n}`,
	row: n,
	controlNumber: `MAINT-26102${n}-00${n}`,
	avisoNumber: `1035611${n}`,
	brigade: "025 ALEXIS DIAZ",
	invoiceNumber: `M17-1035611${n}`,
	subtotal: 100,
	ivu: 11.5,
	total: 111.5,
	avisoHref: `/files/aviso-docs/j${n}-aviso.pdf`,
	invoiceHref: `/files/bank-invoices/j${n}-bank-invoice.pdf`,
	...over,
})

const batch = (over: Partial<BatchView> = {}): BatchView => ({
	id: "b6",
	number: 6,
	status: "open",
	closedAt: null,
	sentAt: null,
	count: 2,
	capacity: 100,
	subtotal: 200,
	advanceRate: 0.8,
	advance: 160,
	hasExcel: false,
	rows: [row(1), row(2, { invoiceHref: null })],
	...over,
})

const green: BatchCheckView = {
	rows: 2,
	avisoPdfs: 2,
	invoicePdfs: 2,
	avisoMismatches: [],
	totalMatches: true,
	duplicates: [],
	noArea: [],
	excel: true,
	passed: true,
}
const parts = [
	{
		part: 1,
		of: 2,
		rowFrom: 1,
		rowTo: 1,
		megabytes: 18.2,
		hasExcel: true,
		subject: "JAF — PBCC Batch #6 — Part 1 of 2",
	},
	{
		part: 2,
		of: 2,
		rowFrom: 2,
		rowTo: 2,
		megabytes: 17.4,
		hasExcel: false,
		subject: "JAF — PBCC Batch #6 — Part 2 of 2",
	},
]

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

describe("open PBCC batch", () => {
	it("shows rows out of 100, the subtotal and the 80% advance", async ({
		renderStub,
	}) => {
		await mount(renderStub, <PbccBatchOpenView batch={batch()} />)
		expect(screen.getByText("PBCC batch · open")).toBeInTheDocument()
		expect(
			screen.getByText(
				"2 of 100 packets · Subtotal $200.00 · 80% advance $160.00",
			),
		).toBeInTheDocument()
		const r1 = screen.getByRole("row", { name: /MAINT-261021-001/ })
		expect(within(r1).getByText("001")).toBeInTheDocument()
		expect(within(r1).getByText("$111.50")).toBeInTheDocument()
		expect(within(r1).getByText("M17-10356111")).toBeInTheDocument()
	})

	it("marks a row whose invoice PDF is missing", async ({ renderStub }) => {
		await mount(renderStub, <PbccBatchOpenView batch={batch()} />)
		const r2 = screen.getByRole("row", { name: /MAINT-261022-002/ })
		expect(within(r2).getByText("—")).toBeInTheDocument()
	})

	it("needs a reason to take a row out, and cannot close an empty batch", async ({
		renderStub,
	}) => {
		await mount(renderStub, <PbccBatchOpenView batch={batch()} />)
		expect(
			screen.getByRole("textbox", { name: /Reason MAINT-261021-001/ }),
		).toBeRequired()
		expect(screen.getAllByRole("button", { name: "Take out" })).toHaveLength(2)
		expect(screen.getByRole("button", { name: "Close batch" })).toBeEnabled()
	})

	it("an empty batch explains itself and cannot be closed", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<PbccBatchOpenView batch={batch({ count: 0, subtotal: 0, rows: [] })} />,
		)
		expect(screen.getByText(/No packets yet/)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Close batch" })).toBeDisabled()
	})

	it("shows an action error with the packets it names", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<PbccBatchOpenView
				batch={batch()}
				action={{ errorKey: "pbcc_batch.errors.no_area", list: "MAINT-1" }}
			/>,
		)
		expect(screen.getByRole("alert")).toHaveTextContent(
			"These packets have no area, so the Excel row cannot be made: MAINT-1",
		)
	})
})

describe("Sent tab", () => {
	it("lists closed batches as ready to send and sent ones with their date", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<PbccBatchListView
				empty="none"
				batches={[
					{
						id: "b6",
						number: 6,
						status: "closed",
						closedAt: "2026-10-22T12:00:00Z",
						sentAt: null,
						count: 47,
						subtotal: 18442.1,
					},
					{
						id: "b5",
						number: 5,
						status: "sent",
						closedAt: "2026-10-15T12:00:00Z",
						sentAt: "2026-10-16T12:00:00Z",
						count: 100,
						subtotal: 1000,
					},
				]}
			/>,
		)
		const closed = screen.getByRole("link", { name: "#6" })
		expect(closed).toHaveAttribute("href", "/finance/schedules/b6")
		expect(screen.getByText("Ready to send")).toBeInTheDocument()
		expect(screen.getByText(/^Sent /)).toBeInTheDocument()
		expect(screen.getByText("47 packets · $18442.10")).toBeInTheDocument()
	})
})

describe("closed PBCC batch", () => {
	const closed = batch({
		status: "closed",
		closedAt: "2026-10-22T12:00:00Z",
		hasExcel: true,
	})

	it("with a green check offers each part with its subject, and Mark sent", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<PbccBatchDetailView batch={closed} check={green} parts={parts} />,
		)
		expect(screen.getByText("Batch check passed")).toBeInTheDocument()
		const downloads = screen.getAllByRole("link", { name: "Download" })
		expect(downloads.map((a) => a.getAttribute("href"))).toEqual([
			"/finance/schedules/b6/package/1",
			"/finance/schedules/b6/package/2",
		])
		expect(
			screen.getByDisplayValue("JAF — PBCC Batch #6 — Part 1 of 2"),
		).toBeInTheDocument()
		expect(screen.getByText(/Excel \(whole batch\) \+/)).toBeInTheDocument()
		expect(
			screen.getByRole("button", { name: "Mark sent to PBCC" }),
		).toBeEnabled()
	})

	it("with a failing check blocks every download and Mark sent", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<PbccBatchDetailView
				batch={closed}
				check={{ ...green, invoicePdfs: 1, passed: false }}
				parts={parts}
			/>,
		)
		expect(screen.getByText("Batch check failed")).toBeInTheDocument()
		expect(screen.queryByRole("link", { name: "Download" })).toBeNull()
		for (const b of screen.getAllByRole("button", { name: "Download" }))
			expect(b).toBeDisabled()
		expect(
			screen.getByRole("button", { name: "Mark sent to PBCC" }),
		).toBeDisabled()
		expect(screen.getByText("2 · 2 · 1")).toBeInTheDocument()
	})

	it("names the Aviso and the area problems the check found", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<PbccBatchDetailView
				batch={closed}
				check={{
					...green,
					avisoMismatches: ["10356112"],
					noArea: ["MAINT-9"],
					duplicates: ["10356111"],
					passed: false,
				}}
				parts={parts}
			/>,
		)
		expect(screen.getByText("1 of 2")).toBeInTheDocument()
		expect(screen.getByText("MAINT-9")).toBeInTheDocument()
		expect(screen.getByText("1 found")).toBeInTheDocument()
	})
})

describe("sent PBCC batch", () => {
	it("is locked: no Mark sent, no check, downloads stay available", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<PbccBatchDetailView
				batch={batch({
					status: "sent",
					closedAt: "2026-10-22T12:00:00Z",
					sentAt: "2026-10-23T12:00:00Z",
					hasExcel: true,
				})}
				check={null}
				parts={parts}
			/>,
		)
		expect(screen.getByText(/can no longer change/)).toBeInTheDocument()
		expect(
			screen.queryByRole("button", { name: "Mark sent to PBCC" }),
		).toBeNull()
		expect(screen.queryByText("Batch check")).toBeNull()
		expect(screen.getAllByRole("link", { name: "Download" })).toHaveLength(2)
	})
})
