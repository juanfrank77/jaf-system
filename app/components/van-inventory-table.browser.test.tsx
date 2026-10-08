import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { VanInventoryTable } from "./van-inventory-table"

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

const row = (id: string, label: string, onVan: number, par: number | null) => ({
	serviceCodeId: id,
	label,
	onVan,
	par,
})

describe("VanInventoryTable", () => {
	it("groups serialized units and accessories under headings", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<VanInventoryTable
				serialized={[row("s1", "ONT", 3, null)]}
				accessories={[row("a1", "Tie wrap", 120, null)]}
				owedBack={[]}
			/>,
		)
		expect(screen.getByText("Serialized units")).toBeInTheDocument()
		expect(screen.getByText("Accessories")).toBeInTheDocument()
	})

	it("flags a below-par row with the word low and shows a dash without par", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<VanInventoryTable
				serialized={[row("s1", "STB", 0, 2)]}
				accessories={[row("a1", "Tie wrap", 5, null)]}
				owedBack={[]}
			/>,
		)
		expect(screen.getByText("low")).toBeInTheDocument()
		expect(screen.getAllByText("—")).toHaveLength(1)
	})

	it("explains an empty van", async ({ renderStub }) => {
		await mount(
			renderStub,
			<VanInventoryTable serialized={[]} accessories={[]} owedBack={[]} />,
		)
		expect(screen.getByText(/No inventory tracked yet/)).toBeInTheDocument()
	})

	it("shows owed-back aging and the pending scan-in wording", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<VanInventoryTable
				serialized={[]}
				accessories={[]}
				owedBack={[
					{ serial: "ALCLED1", sinceDays: 0 },
					{ serial: "ALCLED2", sinceDays: 3 },
				]}
			/>,
		)
		expect(screen.getByText(/removed today/)).toBeInTheDocument()
		expect(screen.getByText(/removed 3 days ago/)).toBeInTheDocument()
		expect(
			screen.getAllByText(/pending scan-in at the warehouse/),
		).toHaveLength(2)
	})
})
