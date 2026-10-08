import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { MaterialLineItems } from "./material-line-items"

const priced = [
	{ id: "c1", claroCode: "1043", name: "Cable", unit: "FT", unitPrice: 2 },
]
const unpriced = [{ id: "c1", claroCode: "1043", name: "Cable", unit: "FT" }]
const items = [{ serviceCodeId: "c1", qty: 3 }]

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

describe("MaterialLineItems read-only price column", () => {
	it("shows the line total by default", async ({ renderStub }) => {
		await mount(
			renderStub,
			<MaterialLineItems serviceCodes={priced} initialItems={items} readOnly />,
		)
		expect(screen.getByText("$6.00")).toBeInTheDocument()
	})

	it("hides the price when showPrice is false", async ({ renderStub }) => {
		await mount(
			renderStub,
			<MaterialLineItems
				serviceCodes={priced}
				initialItems={items}
				readOnly
				showPrice={false}
			/>,
		)
		expect(screen.getByText("Cable")).toBeInTheDocument()
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})

	it("never prints $0.00 when the catalog row has no unitPrice", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<MaterialLineItems
				serviceCodes={unpriced}
				initialItems={items}
				readOnly
			/>,
		)
		expect(screen.getByText("Cable")).toBeInTheDocument()
		expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
	})
})

describe("MaterialLineItems touch (pickup) mode", () => {
	const codes = [
		{ id: "c1", claroCode: "1043", name: "Span clamp", unit: "PZA" },
		{ id: "c2", claroCode: "1044", name: "Tape", unit: "PZA" },
	]

	it("shows Listed, unit and the amber/blue tags", async ({ renderStub }) => {
		await mount(
			renderStub,
			<MaterialLineItems
				serviceCodes={codes}
				initialItems={[
					{ serviceCodeId: "c1", qty: 6 },
					{ serviceCodeId: "c2", qty: 2 },
				]}
				estimatedItems={[{ serviceCodeId: "c1", qty: 4 }]}
				touch
			/>,
		)
		expect(screen.getByText("+2 more than listed")).toBeInTheDocument()
		expect(screen.getByText("added at counter")).toBeInTheDocument()
		expect(screen.getAllByText("PZA").length).toBeGreaterThan(0)
	})

	it("hides the tags when tags is false", async ({ renderStub }) => {
		await mount(
			renderStub,
			<MaterialLineItems
				serviceCodes={codes}
				initialItems={[{ serviceCodeId: "c1", qty: 6 }]}
				estimatedItems={[{ serviceCodeId: "c1", qty: 4 }]}
				listedLabel="Took"
				tags={false}
				touch
			/>,
		)
		expect(screen.getByText(/Took/)).toBeInTheDocument()
		expect(screen.queryByText(/more than listed/)).not.toBeInTheDocument()
	})

	it("caps the stepper at the listed quantity with capToListed", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<MaterialLineItems
				serviceCodes={codes}
				initialItems={[{ serviceCodeId: "c1", qty: 4 }]}
				estimatedItems={[{ serviceCodeId: "c1", qty: 4 }]}
				tags={false}
				capToListed
				touch
			/>,
		)
		const input = screen.getByRole("textbox", { name: "Span clamp" })
		fireEvent.change(input, { target: { value: "9" } })
		expect((input as HTMLInputElement).value).toBe("4")
	})
})

describe("MaterialLineItems picking a material", () => {
	const codes = [
		{ id: "c1", claroCode: "1043", name: "Span clamp", unit: "PZA" },
		{ id: "c2", claroCode: "1044", name: "Tape", unit: "PZA" },
	]

	async function pickTape(renderStub: any, touch: boolean) {
		await mount(
			renderStub,
			<MaterialLineItems
				serviceCodes={codes}
				initialItems={[]}
				name="lines"
				touch={touch}
			/>,
		)
		await userEvent.click(screen.getByRole("button", { name: /add material/i }))
		await userEvent.click(screen.getByRole("combobox"))
		// The catalog is actually listed...
		expect(
			await screen.findByRole("option", { name: /Span clamp/ }),
		).toBeInTheDocument()
		// ...and choosing one puts it on the line.
		await userEvent.click(screen.getByRole("option", { name: /Tape/ }))
		await waitFor(() =>
			expect(screen.getByRole("combobox")).toHaveTextContent(/Tape/),
		)
		const hidden = document.querySelector<HTMLInputElement>(
			'input[name="lines"]',
		)
		expect(JSON.parse(hidden?.value ?? "[]")).toEqual([
			{ serviceCodeId: "c2", qty: 1 },
		])
	}

	it("works in touch mode (restock, pickup, field)", async ({ renderStub }) => {
		await pickTape(renderStub, true)
	})

	it("works in desktop mode", async ({ renderStub }) => {
		await pickTape(renderStub, false)
	})
})
