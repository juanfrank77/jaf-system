import { screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
// `warehouse-stock.server` imports `db`/`Prisma` as TYPES only, so this pure
// resolver is safe to pull into the browser bundle — which is the whole point
// of this file's last test: the lib and the table must agree on which unit
// each number carries, and only wiring one into the other proves it.
import { resolveDualUom } from "~/lib/warehouse-stock.server"
import { StockTable, type StockTableRow } from "./stock-table"

const rows: StockTableRow[] = [
	{
		serviceCodeId: "sc-1",
		canonicalName: "TRANSFER STITCH DE POSTES",
		onHand: 12,
		stockUnit: "FT",
		countUnit: "ROLLOS",
		derivedStockQty: 240,
		claroCode: "SAP-1",
		lastMovement: null,
	},
	{
		serviceCodeId: "sc-2",
		canonicalName: "NO FACTOR MATERIAL",
		onHand: 4,
		stockUnit: "FT",
		countUnit: "ROLLOS",
		derivedStockQty: null,
		claroCode: "SAP-2",
		lastMovement: null,
	},
	{
		serviceCodeId: "sc-3",
		canonicalName: "SPLICE KIT",
		onHand: 3,
		stockUnit: null,
		countUnit: "EA",
		derivedStockQty: null,
		claroCode: "SAP-3",
		lastMovement: null,
	},
]

describe("StockTable", () => {
	it("shows the SAP code and a translated last-movement column", async ({
		renderStub,
	}) => {
		const withLast: StockTableRow[] = [
			{
				...rows[0],
				lastMovement: { type: "RECEIVE", at: "2026-09-20T12:00:00Z" },
			},
			rows[1],
		]
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<StockTable
							rows={withLast}
							selectedCode={null}
							onSelectCode={() => {}}
						/>
					),
				},
			],
		})
		expect(screen.getByText("SAP-1")).toBeInTheDocument()
		expect(screen.getByTestId("stock-last-sc-1").textContent).toMatch(
			/^Received · /,
		)
		expect(screen.getByTestId("stock-last-sc-2").textContent).toBe(
			"No movements yet",
		)
	})

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

	// Integration guard against "two correct halves, never connected": this
	// feeds a REAL resolveDualUom result straight into the table instead of a
	// hand-written row, so an inverted factor (or a renamed field) in the lib
	// fails here rather than shipping as a silently wrong unit on screen.
	it("renders a real resolveDualUom result as <count> <countUnit> = <stock> <stockUnit>", async ({
		renderStub,
	}) => {
		// 12 CAJAS of 100 PZA each = 1200 PZA. The factor is countUnit→stockUnit.
		const dual = resolveDualUom(12, {
			countUnit: "CAJAS",
			stockUnit: "PZA",
			conversionFactor: 100,
		})
		const liveRows: StockTableRow[] = [
			{
				serviceCodeId: "live-1",
				canonicalName: "LIVE DUAL UOM MATERIAL",
				onHand: dual.ledgerQty,
				stockUnit: dual.stockUnit,
				countUnit: dual.countUnit,
				derivedStockQty: dual.derivedStockQty,
				claroCode: "SAP-L",
				lastMovement: null,
			},
		]
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<StockTable
							rows={liveRows}
							selectedCode={null}
							onSelectCode={() => {}}
						/>
					),
				},
			],
		})
		const row = screen.getByTestId("stock-row-live-1")
		expect(row).toHaveTextContent("12 CAJAS")
		expect(row).toHaveTextContent("= 1200 PZA")
		// The inverse convention (stock-unit on the left) must NOT appear.
		expect(row).not.toHaveTextContent("12 PZA")
		expect(row).not.toHaveTextContent("= 1200 CAJAS")
	})
})
