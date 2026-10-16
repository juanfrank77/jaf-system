import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ServicePicker } from "./service-picker"

const line = {
	serviceCodeId: "sc1",
	claroCode: "34005446",
	accountCode: "635",
	name: "REMOCION CONCRETOMO",
	qty: 2,
}

// Same loose typing the other component tests use for the stub fixture.
const mount = (renderStub: any, props: Record<string, unknown>) =>
	renderStub({
		entries: [{ path: "/", Component: () => <ServicePicker {...props} /> }],
	})

describe("ServicePicker saved lines", () => {
	it("shows unit, unit price, line total and subtotal when the catalog meta is supplied", async ({
		renderStub,
	}) => {
		await mount(renderStub, {
			initialLines: [line],
			initialMeta: { sc1: { unit: "FT", unitPrice: 5.06 } },
		})
		const row = screen.getByText("34005446").closest("tr") as HTMLElement
		expect(within(row).getByText("FT")).toBeInTheDocument()
		expect(within(row).getByText("$5.06")).toBeInTheDocument()
		expect(within(row).getByText("$10.12")).toBeInTheDocument()
		expect(screen.getByText("Estimated subtotal (pre-IVU)")).toBeInTheDocument()
	})

	it("falls back to dashes and hides the subtotal when no meta is available", async ({
		renderStub,
	}) => {
		await mount(renderStub, { initialLines: [line] })
		expect(screen.queryByText("Estimated subtotal (pre-IVU)")).toBeNull()
	})

	it("shows no price, line amount or subtotal when prices are hidden", async ({
		renderStub,
	}) => {
		await mount(renderStub, {
			initialLines: [line],
			initialMeta: { sc1: { unit: "FT" } },
			showPrices: false,
		})
		const row = screen.getByText("34005446").closest("tr") as HTMLElement
		expect(within(row).getByText("FT")).toBeInTheDocument()
		expect(row.textContent).not.toContain("$")
		expect(screen.queryByText("Estimated subtotal (pre-IVU)")).toBeNull()
		expect(screen.queryByText("Unit price")).toBeNull()
	})
})
