import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
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
