import { screen, within } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import {
	type PrepAvailability,
	PrepMaterialsTable,
	type PrepRow,
} from "./prep-materials-table"

const codes = [
	{
		id: "m1",
		claroCode: "1019676",
		name: "Abrazadera para Postes",
		unit: "EA",
	},
	{ id: "m2", claroCode: "1003773", name: "CLIP RECTOS", unit: "EA" },
	{ id: "m3", claroCode: "1003728", name: "FITTING POLE PLATE", unit: "EA" },
	{
		id: "m4",
		claroCode: "1003729",
		name: "FITTING POLE PLATE ALT",
		unit: "EA",
	},
]

const row = (
	o: Partial<PrepRow> & { _key: string; serviceCodeId: string },
) => ({
	estimatedQty: 1,
	preppedQty: 1,
	substitutedWith: null,
	missing: false,
	notes: "",
	...o,
})

const stock = (available: number): PrepAvailability => ({
	available,
	countUnit: "EA",
	stockUnit: null,
	derivedAvailable: null,
})

const availability = { m1: stock(5), m2: stock(7), m3: stock(0) }

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

/** The table with its own state, as the route holds it. */
function Harness({ initial }: { initial: PrepRow[] }) {
	const [rows, setRows] = useState(initial)
	return (
		<PrepMaterialsTable
			rows={rows}
			codes={codes}
			availability={availability}
			onChange={(i, patch) =>
				setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
			}
			onRemove={(i) => setRows(rows.filter((_, j) => j !== i))}
		/>
	)
}

const requested: PrepRow[] = [
	row({ _key: "a", serviceCodeId: "m1" }),
	row({ _key: "b", serviceCodeId: "m2", estimatedQty: 10, preppedQty: 10 }),
	row({ _key: "c", serviceCodeId: "m3", estimatedQty: 2, preppedQty: 2 }),
]

const rowOf = (text: string) =>
	within(screen.getByTestId("prep-materials"))
		.getByText(text)
		.closest("tr") as HTMLElement

describe("PrepMaterialsTable", () => {
	it("lists each requested item with what was asked for next to what is in stock", async ({
		renderStub,
	}) => {
		await mount(renderStub, <Harness initial={requested} />)
		const headers = within(screen.getByTestId("prep-materials"))
			.getAllByRole("columnheader")
			.map((h) => h.textContent)
		expect(headers.slice(0, 6)).toEqual([
			"Code",
			"Material",
			"Requested",
			"In stock",
			"Prepped",
			"Status",
		])
		const clip = within(rowOf("CLIP RECTOS"))
		expect(clip.getByText("10 EA")).toBeInTheDocument()
		expect(clip.getByText("7 EA")).toBeInTheDocument()
		expect(clip.getByRole("spinbutton")).toHaveValue(10)
		expect(screen.queryAllByTestId("prep-row-extras")).toHaveLength(0)
	})

	it("flags a row short of what was requested", async ({ renderStub }) => {
		await mount(renderStub, <Harness initial={requested} />)
		expect(within(rowOf("CLIP RECTOS")).getByText("✓ OK")).toBeInTheDocument()
		const qty = within(rowOf("CLIP RECTOS")).getByRole("spinbutton")
		await userEvent.fill(qty, "7")
		expect(
			within(rowOf("CLIP RECTOS")).getByText("Short by 3"),
		).toBeInTheDocument()
	})

	it("typing 0 marks the row out of stock and opens its extras", async ({
		renderStub,
	}) => {
		await mount(renderStub, <Harness initial={requested} />)
		await userEvent.fill(
			within(rowOf("FITTING POLE PLATE")).getByRole("spinbutton"),
			"0",
		)
		expect(
			within(rowOf("FITTING POLE PLATE")).getByText("Out of stock"),
		).toBeInTheDocument()
		const extras = screen.getByTestId("prep-row-extras")
		expect(within(extras).getByRole("checkbox")).toBeChecked()
	})

	it("More opens Replace with, Out of stock and a note; ticking Out of stock zeroes Prepped", async ({
		renderStub,
	}) => {
		await mount(renderStub, <Harness initial={requested} />)
		await userEvent.click(
			within(rowOf("CLIP RECTOS")).getByRole("button", { name: /More/ }),
		)
		const extras = screen.getByTestId("prep-row-extras")
		await userEvent.click(within(extras).getByRole("checkbox"))
		expect(within(rowOf("CLIP RECTOS")).getByRole("spinbutton")).toHaveValue(0)
		expect(
			within(rowOf("CLIP RECTOS")).getByText("Out of stock"),
		).toBeInTheDocument()
		// Un-ticking restores what was requested.
		await userEvent.click(within(extras).getByRole("checkbox"))
		expect(within(rowOf("CLIP RECTOS")).getByRole("spinbutton")).toHaveValue(10)
	})

	it("offers only materials not already on the list as a replacement", async ({
		renderStub,
	}) => {
		await mount(renderStub, <Harness initial={requested} />)
		await userEvent.click(
			within(rowOf("FITTING POLE PLATE")).getByRole("button", {
				name: /More/,
			}),
		)
		const select = within(screen.getByTestId("prep-row-extras")).getByLabelText(
			"Replace with",
		)
		const options = within(select)
			.getAllByRole("option")
			.map((o) => o.textContent)
		expect(options).toEqual([
			"No replacement",
			"1003729 — FITTING POLE PLATE ALT",
		])
	})

	it("starts open for a row that already has a flag, a replacement or a note", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<Harness
				initial={[
					row({ _key: "a", serviceCodeId: "m1", notes: "damaged box" }),
					row({ _key: "b", serviceCodeId: "m2" }),
				]}
			/>,
		)
		expect(screen.getAllByTestId("prep-row-extras")).toHaveLength(1)
		expect(screen.getByDisplayValue("damaged box")).toBeInTheDocument()
	})

	it("a material the warehouse adds shows no requested quantity and can be removed", async ({
		renderStub,
	}) => {
		const onRemove = vi.fn()
		await mount(
			renderStub,
			<PrepMaterialsTable
				rows={[
					row({ _key: "n", serviceCodeId: "", estimatedQty: 0, preppedQty: 1 }),
				]}
				codes={codes}
				availability={availability}
				onChange={vi.fn()}
				onRemove={onRemove}
			/>,
		)
		expect(
			within(screen.getByTestId("prep-materials")).getByLabelText(
				"Select material…",
			),
		).toBeInTheDocument()
		await userEvent.click(
			screen.getAllByRole("button", { name: "Remove line" })[0],
		)
		expect(onRemove).toHaveBeenCalledWith(0)
	})

	it("a material the warehouse picked can still be removed or changed", async ({
		renderStub,
	}) => {
		const onRemove = vi.fn()
		const onChange = vi.fn()
		await mount(
			renderStub,
			<PrepMaterialsTable
				rows={[
					row({
						_key: "n",
						serviceCodeId: codes[0].id,
						estimatedQty: 0,
						preppedQty: 1,
					}),
				]}
				codes={codes}
				availability={availability}
				onChange={onChange}
				onRemove={onRemove}
			/>,
		)
		await userEvent.selectOptions(
			screen.getByLabelText("Select material…"),
			codes[1].id,
		)
		expect(onChange).toHaveBeenCalledWith(0, {
			serviceCodeId: codes[1].id,
			substitutedWith: null,
		})
		await userEvent.click(
			screen.getAllByRole("button", { name: "Remove line" })[0],
		)
		expect(onRemove).toHaveBeenCalledWith(0)
	})
})
