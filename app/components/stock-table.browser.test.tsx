import { screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { StockTable, type StockTableRow } from "./stock-table"

const rows: StockTableRow[] = [
	{
		serviceCodeId: "sc-1",
		canonicalName: "TRANSFER STITCH DE POSTES",
		onHand: 12,
		stockUnit: "FT",
		countUnit: "ROLLOS",
		derivedCountQty: 240,
	},
	{
		serviceCodeId: "sc-2",
		canonicalName: "NO FACTOR MATERIAL",
		onHand: 4,
		stockUnit: "FT",
		countUnit: "ROLLOS",
		derivedCountQty: null,
	},
	{
		serviceCodeId: "sc-3",
		canonicalName: "SPLICE KIT",
		onHand: 3,
		stockUnit: null,
		countUnit: "EA",
		derivedCountQty: null,
	},
]

describe("StockTable", () => {
	it("renders the derived stock-unit figure when a conversion factor is set", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<StockTable
							rows={rows}
							selectedCode={null}
							onSelectCode={() => {}}
						/>
					),
				},
			],
		})
		expect(screen.getByText("TRANSFER STITCH DE POSTES")).toBeInTheDocument()
		expect(screen.getByText("= 240 FT")).toBeInTheDocument()
	})

	it('hides the derived figure and shows "unit not set" when there is no factor', async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<StockTable
							rows={rows}
							selectedCode={null}
							onSelectCode={() => {}}
						/>
					),
				},
			],
		})
		const row = screen.getByTestId("stock-row-sc-2")
		expect(row).toHaveTextContent("—")
		expect(row).toHaveTextContent("unit not set")
	})

	it("filters rows by canonical name as the search box changes", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<StockTable
							rows={rows}
							selectedCode={null}
							onSelectCode={() => {}}
						/>
					),
				},
			],
		})
		await userEvent.type(
			screen.getByRole("searchbox", { name: "Search materials" }),
			"no factor",
		)
		expect(screen.getByText("NO FACTOR MATERIAL")).toBeInTheDocument()
		expect(
			screen.queryByText("TRANSFER STITCH DE POSTES"),
		).not.toBeInTheDocument()
	})

	it("narrows to kit/used-in rows when the filter is checked", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<StockTable
							rows={rows}
							selectedCode={null}
							onSelectCode={() => {}}
						/>
					),
				},
			],
		})
		await userEvent.click(
			screen.getByRole("checkbox", { name: "Kit / used-in only" }),
		)
		expect(screen.getByText("SPLICE KIT")).toBeInTheDocument()
		expect(
			screen.queryByText("TRANSFER STITCH DE POSTES"),
		).not.toBeInTheDocument()
	})

	it("toggles the trail selection when its button is clicked", async ({
		renderStub,
	}) => {
		const onSelectCode = vi.fn()
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<StockTable
							rows={rows}
							selectedCode={null}
							onSelectCode={onSelectCode}
						/>
					),
				},
			],
		})
		const row = screen.getByTestId("stock-row-sc-1")
		await userEvent.click(row.querySelector("button") as HTMLButtonElement)
		expect(onSelectCode).toHaveBeenCalledWith("sc-1")
	})
})
