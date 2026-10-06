import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { MaterialPicker } from "./material-picker"

const materials = [
	{
		id: "m1",
		claroCode: "100200",
		name: "CABLE 24 FIBER",
		unit: "FT",
		unitPrice: 0,
	},
	{
		id: "m2",
		claroCode: "100300",
		name: "POLE 30 C5",
		unit: "EA",
		unitPrice: 0,
	},
	{
		id: "m3",
		claroCode: "100400",
		name: "SPLICE CLOSURE",
		unit: null,
		unitPrice: 0,
	},
]

// Same loose typing the other component tests use for the stub fixture.
const mount = (renderStub: any, props: Record<string, unknown> = {}) =>
	renderStub({
		entries: [
			{
				path: "/",
				Component: () => <MaterialPicker materials={materials} {...props} />,
			},
		],
	})

const posted = () =>
	JSON.parse(
		(document.querySelector('input[name="materials"]') as HTMLInputElement)
			.value,
	)

const search = (text: string) =>
	userEvent.type(screen.getByRole("searchbox"), text)

describe("MaterialPicker", () => {
	it("lists every active material when the search field is focused, then narrows as you type", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		expect(screen.queryByRole("button", { name: /CABLE 24 FIBER/ })).toBeNull()
		await userEvent.click(screen.getByRole("searchbox"))
		for (const n of [/CABLE 24 FIBER/, /POLE 30 C5/, /SPLICE CLOSURE/])
			expect(screen.getByRole("button", { name: n })).toBeInTheDocument()
		expect(screen.getByText("3 of 3 materials shown")).toBeInTheDocument()
		await search("sp")
		expect(screen.queryByRole("button", { name: /POLE 30 C5/ })).toBeNull()
		expect(
			screen.getByRole("button", { name: /SPLICE CLOSURE/ }),
		).toBeInTheDocument()
		expect(screen.getByText("1 of 3 materials shown")).toBeInTheDocument()
	})

	it("closes the list on Escape or when focus leaves, and after picking one", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		await userEvent.click(screen.getByRole("searchbox"))
		await userEvent.keyboard("{Escape}")
		expect(screen.queryByRole("button", { name: /POLE 30 C5/ })).toBeNull()
		await userEvent.click(screen.getByRole("searchbox"))
		await userEvent.click(screen.getByRole("button", { name: /POLE 30 C5/ }))
		expect(screen.queryByRole("button", { name: /CABLE 24 FIBER/ })).toBeNull()
		expect(posted()).toEqual([{ serviceCodeId: "m2", qty: 1 }])
	})

	it("starts with an empty state that says what the field is for", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		expect(screen.getByText(/No materials yet/)).toBeInTheDocument()
		expect(posted()).toEqual([])
	})

	it("searches by description or code, adds a material with quantity 1, and clears the search", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		await search("pole")
		await userEvent.click(screen.getByRole("button", { name: /POLE 30 C5/ }))
		expect(posted()).toEqual([{ serviceCodeId: "m2", qty: 1 }])
		expect(screen.getByRole("searchbox")).toHaveValue("")
		const row = screen.getByText("100300").closest("tr") as HTMLElement
		expect(within(row).getByText("POLE 30 C5")).toBeInTheDocument()
		expect(within(row).getByText("EA")).toBeInTheDocument()

		await search("1004")
		expect(
			screen.getByRole("button", { name: /SPLICE CLOSURE/ }),
		).toBeInTheDocument()
	})

	it("does not offer a material that is already in the table", async ({
		renderStub,
	}) => {
		await mount(renderStub, { initialItems: [{ serviceCodeId: "m1", qty: 3 }] })
		await search("cable")
		expect(screen.queryByRole("button", { name: /CABLE 24 FIBER/ })).toBeNull()
		expect(screen.getByText(/No materials match/)).toBeInTheDocument()
	})

	it("edits the quantity and removes a row", async ({ renderStub }) => {
		await mount(renderStub, {
			initialItems: [
				{ serviceCodeId: "m1", qty: 3 },
				{ serviceCodeId: "m2", qty: 1 },
			],
		})
		const qty = screen.getAllByRole("spinbutton")[0]
		await userEvent.clear(qty)
		await userEvent.type(qty, "7")
		expect(posted()).toEqual([
			{ serviceCodeId: "m1", qty: 7 },
			{ serviceCodeId: "m2", qty: 1 },
		])
		await userEvent.click(
			screen.getAllByRole("button", { name: "Remove material" })[0],
		)
		expect(posted()).toEqual([{ serviceCodeId: "m2", qty: 1 }])
	})

	it("keeps a saved line whose material is no longer in the active catalog", async ({
		renderStub,
	}) => {
		await mount(renderStub, {
			initialItems: [{ serviceCodeId: "gone", qty: 2 }],
		})
		expect(posted()).toEqual([{ serviceCodeId: "gone", qty: 2 }])
		expect(screen.getAllByRole("row")).toHaveLength(2)
	})
})
