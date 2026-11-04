import { screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { page, userEvent } from "vitest/browser"
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
		source: "WAREHOUSE_ISSUE",
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
		source: "TRUCK_STOCK",
	},
]

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

describe("FieldMaterialsTable", () => {
	// The table shows from `md`; the phone test narrows the viewport itself.
	beforeEach(async () => {
		await page.viewport(1024, 768)
	})

	it("on a phone each material is a card: Used, Returned and Source all visible, no side scroll", async ({
		renderStub,
	}) => {
		await page.viewport(390, 800)
		await mount(
			renderStub,
			<FieldMaterialsTable rows={rows} onChange={vi.fn()} onRemove={vi.fn()} />,
		)
		const wrap = screen.getByText("WRAP NET").closest("tr") as HTMLElement
		for (const label of ["Used", "Returned", "Source"]) {
			expect(within(wrap).getByLabelText(label)).toBeVisible()
		}
		const table = screen.getByTestId("field-materials")
		expect(table.scrollWidth).toBeLessThanOrEqual(table.clientWidth)
	})

	it("renders the seven columns, one row per material", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<FieldMaterialsTable rows={rows} onChange={vi.fn()} onRemove={vi.fn()} />,
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
			"",
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
			<FieldMaterialsTable
				rows={rows}
				onChange={onChange}
				onRemove={vi.fn()}
			/>,
		)
		const wrap = screen.getByText("WRAP NET").closest("tr") as HTMLElement
		await userEvent.fill(within(wrap).getByLabelText("Used"), "3")
		expect(onChange).toHaveBeenLastCalledWith(0, {
			serviceCodeId: "m1",
			used: 3,
			returned: 0,
			source: "WAREHOUSE_ISSUE",
		})
	})

	it("editing Returned calls onChange with the updated row", async ({
		renderStub,
	}) => {
		const onChange = vi.fn()
		await mount(
			renderStub,
			<FieldMaterialsTable
				rows={rows}
				onChange={onChange}
				onRemove={vi.fn()}
			/>,
		)
		const wrap = screen.getByText("WRAP NET").closest("tr") as HTMLElement
		await userEvent.fill(within(wrap).getByLabelText("Returned"), "2")
		expect(onChange).toHaveBeenLastCalledWith(0, {
			serviceCodeId: "m1",
			used: 5,
			returned: 2,
			source: "WAREHOUSE_ISSUE",
		})
	})

	it("the source select switches between Sources", async ({ renderStub }) => {
		const onChange = vi.fn()
		await mount(
			renderStub,
			<FieldMaterialsTable
				rows={rows}
				onChange={onChange}
				onRemove={vi.fn()}
			/>,
		)
		const wrap = screen.getByText("WRAP NET").closest("tr") as HTMLElement
		const clamp = screen.getByText("CLAMP").closest("tr") as HTMLElement
		await userEvent.selectOptions(
			within(wrap).getByLabelText("Source"),
			"TRUCK_STOCK",
		)
		expect(onChange).toHaveBeenLastCalledWith(0, {
			serviceCodeId: "m1",
			used: 5,
			returned: 0,
			source: "TRUCK_STOCK",
		})
		await userEvent.selectOptions(
			within(clamp).getByLabelText("Source"),
			"WAREHOUSE_ISSUE",
		)
		expect(onChange).toHaveBeenLastCalledWith(1, {
			serviceCodeId: "m2",
			used: 2,
			returned: 0,
			source: "WAREHOUSE_ISSUE",
		})
	})

	it("marks Used and Source with the field-required class and lists five Sources", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<FieldMaterialsTable rows={rows} onChange={vi.fn()} onRemove={vi.fn()} />,
		)
		const wrap = screen.getByText("WRAP NET").closest("tr") as HTMLElement
		expect(within(wrap).getByLabelText("Used")).toHaveClass("field-required")
		expect(within(wrap).getByLabelText("Source")).toHaveClass("field-required")
		const options = within(within(wrap).getByLabelText("Source"))
			.getAllByRole("option")
			.map((o) => o.textContent)
		expect(options).toEqual([
			"Warehouse issue",
			"Existing material at site",
			"Claro drop-off",
			"Truck stock",
			"Crew personal storage",
		])
	})

	it("shows the options in Spanish", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<FieldMaterialsTable
							rows={rows}
							onChange={vi.fn()}
							onRemove={vi.fn()}
						/>
					),
				},
			],
			i18n: { lng: "es" },
		})
		expect(screen.getAllByText("Inventario del camión").length).toBeGreaterThan(
			0,
		)
		expect(screen.getByText("Entregado (firmado)")).toBeInTheDocument()
		// The spec's B2 labels.
		for (const label of [
			"Entregado por almacén",
			"Material existente en el sitio",
			"Almacén personal de la brigada",
		])
			expect(screen.getAllByText(label).length).toBeGreaterThan(0)
	})

	it("only a row the crew added can be removed", async ({ renderStub }) => {
		const onRemove = vi.fn()
		await mount(
			renderStub,
			<FieldMaterialsTable
				rows={rows}
				onChange={vi.fn()}
				onRemove={onRemove}
			/>,
		)
		expect(
			screen.queryByRole("button", { name: /Remove material 1020002/ }),
		).toBeNull()
		await userEvent.click(
			screen.getByRole("button", { name: /Remove material 1020003/ }),
		)
		expect(onRemove).toHaveBeenCalledWith(1)
	})
})
