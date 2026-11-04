import { screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { ServicePicker, ServiceSearch } from "./service-picker"

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
		expect(screen.getByText("Estimated subtotal")).toBeInTheDocument()
	})

	it("falls back to dashes and hides the subtotal when no meta is available", async ({
		renderStub,
	}) => {
		await mount(renderStub, { initialLines: [line] })
		expect(screen.queryByText("Estimated subtotal")).toBeNull()
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
		expect(screen.queryByText("Estimated subtotal")).toBeNull()
		expect(screen.queryByText("Unit price")).toBeNull()
	})
})

describe("ServiceSearch results", () => {
	it("lists all 8 results without an inner scroll area", async ({
		renderStub,
	}) => {
		const results = Array.from({ length: 8 }, (_, i) => ({
			id: `r${i}`,
			claroCode: `3400642${i}`,
			name: `SERVICIO ${i}`,
			accountCode: "610",
			unit: "EA",
		}))
		await renderStub({
			entries: [
				{
					path: "/api/service-codes",
					loader: () => ({ total: 934, results }),
				},
				{
					path: "/",
					Component: () => <ServiceSearch onPick={() => {}} />,
				},
			],
		})
		await userEvent.type(screen.getByRole("searchbox"), "3400642")
		await waitFor(() =>
			expect(screen.getByText("34006427")).toBeInTheDocument(),
		)
		expect(screen.getAllByRole("listitem")).toHaveLength(8)
		const list = screen.getByRole("list") as HTMLElement
		for (const el of [list, list.parentElement as HTMLElement]) {
			expect(el.className).not.toMatch(/overflow-y|max-h/)
		}
	})
})
