import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SerialRegister, type SerialStockRow } from "./serial-register"

const rows: SerialStockRow[] = [
	{ serviceCodeId: "sc-1", condition: "NEW", count: 3 },
	{ serviceCodeId: "sc-1", condition: "REFURBISHED", count: 1 },
	{ serviceCodeId: "sc-2", condition: "NEW", count: 2 },
]

const codeNames = {
	"sc-1": { claroCode: "34006428", name: "ONT XYZ" },
	"sc-2": { claroCode: "34009999", name: "ONT ABC" },
}

describe("SerialRegister", () => {
	it("groups rows by material with NEW/REFURBISHED counts", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => <SerialRegister rows={rows} codeNames={codeNames} />,
				},
			],
		})
		const first = screen.getByText("34006428 — ONT XYZ").closest("div")
		expect(first).toHaveTextContent("New 3")
		expect(first).toHaveTextContent("Refurbished 1")
		expect(screen.getByText("34009999 — ONT ABC")).toBeInTheDocument()
	})

	it("shows an empty state when there is no serialized stock", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => <SerialRegister rows={[]} codeNames={{}} />,
				},
			],
		})
		expect(screen.getByText("No serialized stock on hand.")).toBeInTheDocument()
	})
})
