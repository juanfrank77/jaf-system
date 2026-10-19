import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AvisoMatchCard } from "./aviso-match"

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

const invoiceLines = [
	{
		serviceCodeId: "c1",
		claroCode: "34012039",
		name: "REMOCION BAJANTE",
		qty: 1,
		unitPrice: 10,
		lineAmount: 10,
	},
] as any

const base = {
	docId: "d1",
	avisoNumber: null,
	avisoDocPath: null,
	storedLines: [],
	locked: false,
	invoiceLines,
	ordered: [],
	certified: undefined,
	catalogPrices: {},
	tolerance: 0.01,
	error: null,
	readOnly: false,
	started: false,
	showPrices: false,
}

describe("AvisoMatchCard for a price-blind role", () => {
	it("shows no editable quantities or prices and no money before an upload", async ({
		renderStub,
	}) => {
		await mount(renderStub, <AvisoMatchCard {...base} />)
		expect(screen.queryByRole("spinbutton")).toBeNull()
		expect(screen.queryByText(/\$/)).toBeNull()
		// Nothing captured yet: the charged cell is a dash, not the installed qty.
		expect(screen.getByText("—")).toBeInTheDocument()
	})

	it("shows the captured quantity read-only after the PDF was read", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<AvisoMatchCard
				{...base}
				started
				avisoNumber="10350001"
				avisoDocPath="/x.pdf"
				storedLines={[
					{
						serviceCodeId: "c1",
						claroCode: "34012039",
						qty: 2,
						unitPrice: 10,
						lineAmount: 20,
					},
				]}
			/>,
		)
		expect(screen.queryByRole("spinbutton")).toBeNull()
		expect(screen.getByText("2")).toBeInTheDocument()
		expect(screen.queryByText(/\$/)).toBeNull()
	})

	it("lists the catalog gaps when the server refuses the Aviso", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<AvisoMatchCard
				{...base}
				error={{
					errorKey: "docs_review.errors.aviso_codes_missing",
					missingCodes: ["34099999", "34088888"],
				}}
			/>,
		)
		expect(screen.getByText(/34099999, 34088888/)).toBeInTheDocument()
	})
})

describe("AvisoMatchCard with prices stripped (what a supervisor's loader sends)", () => {
	const blindInvoice = [
		{ serviceCodeId: "c1", claroCode: "34012039", name: "REMOCION", qty: 1 },
	] as any
	const blindStored = [
		{ serviceCodeId: "c1", claroCode: "34012039", qty: 1 },
	] as any

	it("takes the amount verdict from the server: agreeing quantities read as agreed", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<AvisoMatchCard
				{...base}
				invoiceLines={blindInvoice}
				storedLines={blindStored}
				started
				avisoDocPath="/x.pdf"
				serverAmountOk
			/>,
		)
		expect(screen.getByText("Aviso and JAF invoice agree.")).toBeInTheDocument()
		expect(screen.queryByText(/\$|NaN/)).toBeNull()
	})

	it("shows the blocked state when the server says the totals disagree", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<AvisoMatchCard
				{...base}
				invoiceLines={blindInvoice}
				storedLines={blindStored}
				started
				avisoDocPath="/x.pdf"
				serverAmountOk={false}
			/>,
		)
		expect(
			screen.getByText("Blocked — Aviso total does not match the JAF invoice."),
		).toBeInTheDocument()
		expect(screen.queryByText(/\$|NaN/)).toBeNull()
	})
})

describe("AvisoMatchCard for Finance/Admin", () => {
	it("keeps the editable quantity and price fields", async ({ renderStub }) => {
		await mount(renderStub, <AvisoMatchCard {...base} showPrices />)
		expect(screen.getAllByRole("spinbutton")).toHaveLength(2)
	})
})
