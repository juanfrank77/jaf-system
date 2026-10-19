import { screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import {
	FieldMaterialsTable,
	type FieldMaterialsTableRow,
} from "./field-materials-table"

const rows: FieldMaterialsTableRow[] = [
	{
		serviceCodeId: "m1",
		claroCode: "1020002",
		name: "WRAP NET",
		unit: "EA",
		estimated: 6,
		signed: 5,
		used: 5,
		returned: 0,
		source: "WAREHOUSE",
	},
	{
		serviceCodeId: "m2",
		claroCode: "1020003",
		name: "CLAMP",
		unit: "EA",
		estimated: 0,
		signed: 0,
		used: 2,
		returned: 0,
		source: "BRIGADE_STOCK",
	},
]

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

describe("FieldMaterialsTable", () => {
	it("renders the seven columns, one row per material", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<FieldMaterialsTable rows={rows} onChange={vi.fn()} />,
		)
		const table = screen.getByTestId("field-materials")
		const headers = within(table)
			.getAllByRole("columnheader")
			.map((h) => h.textContent)
		expect(headers).toEqual([
			"Code",
			"Material",
			"Estimated",
			"Issued (signed)",
			"Used",
			"Returned",
			"Source",
		])
		const wrap = within(table)
			.getByText("WRAP NET")
			.closest("tr") as HTMLElement
		expect(wrap).toHaveTextContent("1020002")
		expect(wrap).toHaveTextContent("6")
		expect(wrap).toHaveTextContent("5")
		expect(table).not.toHaveTextContent("$")
	})

	it("editing Used calls onChange with the updated row", async ({
		renderStub,
	}) => {
		const onChange = vi.fn()
		await mount(
			renderStub,
			<FieldMaterialsTable rows={rows} onChange={onChange} />,
		)
		const wrap = screen.getByText("WRAP NET").closest("tr") as HTMLElement
		await userEvent.fill(within(wrap).getByLabelText("Used"), "3")
		expect(onChange).toHaveBeenLastCalledWith(0, {
			serviceCodeId: "m1",
			used: 3,
			returned: 0,
			source: "WAREHOUSE",
		})
	})

	it("editing Returned calls onChange with the updated row", async ({
		renderStub,
	}) => {
		const onChange = vi.fn()
		await mount(
			renderStub,
			<FieldMaterialsTable rows={rows} onChange={onChange} />,
		)
		const wrap = screen.getByText("WRAP NET").closest("tr") as HTMLElement
		await userEvent.fill(within(wrap).getByLabelText("Returned"), "2")
		expect(onChange).toHaveBeenLastCalledWith(0, {
			serviceCodeId: "m1",
			used: 5,
			returned: 2,
			source: "WAREHOUSE",
		})
	})

	it("the source select toggles WAREHOUSE / BRIGADE_STOCK", async ({
		renderStub,
	}) => {
		const onChange = vi.fn()
		await mount(
			renderStub,
			<FieldMaterialsTable rows={rows} onChange={onChange} />,
		)
		const wrap = screen.getByText("WRAP NET").closest("tr") as HTMLElement
		const clamp = screen.getByText("CLAMP").closest("tr") as HTMLElement
		await userEvent.selectOptions(
			within(wrap).getByLabelText("Source"),
			"BRIGADE_STOCK",
		)
		expect(onChange).toHaveBeenLastCalledWith(0, {
			serviceCodeId: "m1",
			used: 5,
			returned: 0,
			source: "BRIGADE_STOCK",
		})
		await userEvent.selectOptions(
			within(clamp).getByLabelText("Source"),
			"WAREHOUSE",
		)
		expect(onChange).toHaveBeenLastCalledWith(1, {
			serviceCodeId: "m2",
			used: 2,
			returned: 0,
			source: "WAREHOUSE",
		})
	})

	it("shows the options in Spanish", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<FieldMaterialsTable rows={rows} onChange={vi.fn()} />
					),
				},
			],
			i18n: { lng: "es" },
		})
		expect(
			screen.getAllByText("Inventario de la brigada").length,
		).toBeGreaterThan(0)
		expect(screen.getByText("Entregado (firmado)")).toBeInTheDocument()
	})
})
