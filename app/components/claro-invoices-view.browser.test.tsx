import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ClaroInvoicesView } from "./claro-invoices-view"

const counts = { toMake: 1, notLoaded: 1, inAriba: 0 }

describe("ClaroInvoicesView", () => {
	it("To make: rows are pre-selected with a work month and a Make button", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<ClaroInvoicesView
							counts={counts}
							tab="to_make"
							toMake={[
								{
									poId: "p1",
									poNumber: "4500526054",
									avisoNumber: "10343504",
									total: 894.03,
									suggestedMonth: "2026-05",
								},
							]}
							invoices={[]}
						/>
					),
				},
			],
		})
		expect(await screen.findByText("4500526054")).toBeInTheDocument()
		expect(screen.getByRole("checkbox")).toBeChecked()
		expect(screen.getByLabelText("Work month")).toHaveValue("2026-05")
		expect(
			screen.getByRole("button", { name: "Make invoices" }),
		).toBeInTheDocument()
	})

	it("Not loaded: shows download and mark-loaded, with the made date month-first", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<ClaroInvoicesView
							counts={counts}
							tab="not_loaded"
							toMake={[]}
							invoices={[
								{
									id: "i1",
									number: "M19-4320",
									poNumber: "4500526054",
									avisoNumber: "10343504",
									total: 894.03,
									madeAt: "2026-09-23T15:00:00.000Z",
									loadedAt: null,
									dueDate: null,
								},
							]}
						/>
					),
				},
			],
		})
		expect(await screen.findByText("M19-4320")).toBeInTheDocument()
		expect(screen.getByText("09/23/2026")).toBeInTheDocument()
		expect(
			screen.getByRole("button", { name: "Mark loaded in Ariba" }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("button", { name: "Download selected (zip)" }),
		).toBeInTheDocument()
	})
})
