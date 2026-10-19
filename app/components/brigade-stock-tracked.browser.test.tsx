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
