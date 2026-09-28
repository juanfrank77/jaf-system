import { screen, waitFor } from "@testing-library/react"
import { useLoaderData } from "react-router"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { StockScreen, type StockScreenData } from "./stock-screen"

function loaderDataAt(onHand: number): StockScreenData {
	return {
		selectedId: "wh-1",
		bulk: [
			{
				serviceCodeId: "sc-1",
				canonicalName: "SPLICE ENCLOSURE",
				onHand,
				stockUnit: "FT",
				countUnit: "ROLLOS",
				derivedStockQty: onHand * 10,
			},
		],
		serial: [],
		query: "",
		isLead: false,
		materialCodes: [
			{
				id: "sc-1",
				claroCode: "34006428",
				name: "SPLICE ENCLOSURE",
				unit: "EA",
				unitPrice: 12.5,
			},
		],
		serialCodeNames: {},
		snapshots: [],
	}
}

describe("StockScreen — receive flow (Task 8 review: on-hand rises after receive)", () => {
	it("raises the stock table's on-hand figure after the embedded Receive panel posts and revalidates", async ({
		renderStub,
	}) => {
		let loaderCalls = 0
		await renderStub({
			entries: [
				{
					path: "/",
					loader: async () => {
						loaderCalls += 1
						// First render: 12 on hand. After Receive succeeds and the
						// panel calls revalidate(), the loader re-runs and the route
						// picks up the (simulated) post-delivery figure.
						return loaderDataAt(loaderCalls === 1 ? 12 : 62)
					},
					Component: () => {
						const data = useLoaderData() as StockScreenData
						return <StockScreen {...data} />
					},
				},
				{
					path: "/warehouse/stock/receive",
					action: async () => ({ ok: true }),
					Component: () => null,
				},
			],
		})

		expect(await screen.findByText("12 ROLLOS")).toBeInTheDocument()

		await userEvent.click(
			screen.getByRole("button", { name: "Record delivery" }),
		)

		await waitFor(() => {
			expect(screen.getByText("62 ROLLOS")).toBeInTheDocument()
		})
		expect(screen.queryByText("12 ROLLOS")).not.toBeInTheDocument()
		expect(loaderCalls).toBe(2)
	})

	it("shows the receive success message once the fetcher resolves", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					loader: async () => loaderDataAt(5),
					Component: () => {
						const data = useLoaderData() as StockScreenData
						return <StockScreen {...data} />
					},
				},
				{
					path: "/warehouse/stock/receive",
					action: async () => ({ ok: true }),
					Component: () => null,
				},
			],
		})

		await userEvent.click(
			screen.getByRole("button", { name: "Record delivery" }),
		)

		await waitFor(() => {
			expect(screen.getByText("Delivery recorded.")).toBeInTheDocument()
		})
	})

	it("does not render the lead-only Adjust/Snapshot panels for a non-lead", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					loader: async () => loaderDataAt(5),
					Component: () => {
						const data = useLoaderData() as StockScreenData
						return <StockScreen {...data} />
					},
				},
			],
		})
		expect(
			screen.queryByRole("heading", { name: "Adjust Stock" }),
		).not.toBeInTheDocument()
		expect(
			screen.queryByRole("heading", { name: "Snapshot As-Of" }),
		).not.toBeInTheDocument()
	})
})
