import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { BrigadeStockTracked } from "./brigade-stock-tracked"

describe("BrigadeStockTracked", () => {
	it("lists brigade's-stock use (code, name, qty) as tracked, not billed", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<BrigadeStockTracked
							lines={[
								{
									serviceCodeId: "m1",
									claroCode: "1005803",
									name: "Drop cable",
									qty: 4,
									unit: "FT",
								},
							]}
						/>
					),
				},
			],
		})
		const section = await screen.findByRole("region", {
			name: "Brigade's stock (tracked, not billed)",
		})
		expect(section).toHaveTextContent("1005803")
		expect(section).toHaveTextContent("Drop cable")
		expect(section).toHaveTextContent("4")
		expect(section).not.toHaveTextContent("$")
	})

	it("lists two uncatalogued codes (no Claro code) as two rows", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<BrigadeStockTracked
							lines={[
								{
									serviceCodeId: "x1",
									claroCode: "",
									name: "x1",
									qty: 1,
									unit: null,
								},
								{
									serviceCodeId: "x2",
									claroCode: "",
									name: "x2",
									qty: 2,
									unit: null,
								},
							]}
						/>
					),
				},
			],
		})
		const section = await screen.findByRole("region")
		expect(section.querySelectorAll("tbody tr")).toHaveLength(2)
	})

	it("renders nothing when there is no brigade's stock", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<div data-testid="host">
							<BrigadeStockTracked lines={[]} />
						</div>
					),
				},
			],
		})
		expect(await screen.findByTestId("host")).toBeEmptyDOMElement()
	})
})
