import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { WarehouseDocList } from "./warehouse-doc-list"

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

const doc = {
	id: "d1",
	controlNumber: "JAF-2026-0001",
	status: "PREPPED" as const,
	jobType: "Install",
	jobAddressEstimated: "Calle 1",
	createdAt: new Date("2026-10-01T12:00:00Z"),
}

describe("WarehouseDocList", () => {
	it("links a prep row to the prep screen", async ({ renderStub }) => {
		await mount(renderStub, <WarehouseDocList kind="prep" docs={[doc]} />)
		expect(screen.getByRole("link", { name: /JAF-2026-0001/ })).toHaveAttribute(
			"href",
			"/docs/d1/prep",
		)
	})

	it("links release rows to the signature screen and shows aging", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<WarehouseDocList
				kind="release"
				docs={[{ ...doc, aged: true, daysStaged: 5 }]}
			/>,
		)
		expect(screen.getByRole("link", { name: /JAF-2026-0001/ })).toHaveAttribute(
			"href",
			"/docs/d1/sign",
		)
		expect(screen.getByText("Aged > 3 days")).toBeInTheDocument()
	})

	it("links returns rows to the returns screen", async ({ renderStub }) => {
		await mount(renderStub, <WarehouseDocList kind="returns" docs={[doc]} />)
		expect(screen.getByRole("link", { name: /JAF-2026-0001/ })).toHaveAttribute(
			"href",
			"/docs/d1/returns",
		)
	})

	it("renders nothing-here message for an empty prep list", async ({
		renderStub,
	}) => {
		await mount(renderStub, <WarehouseDocList kind="prep" docs={[]} />)
		expect(screen.getByText("Nothing here right now.")).toBeInTheDocument()
	})
})
