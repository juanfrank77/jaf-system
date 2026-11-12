import { screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { RestockHandOver } from "./restock-hand-over"

const lines = [
	{
		id: "l1",
		brigade: "124 ANGEL D JIMENEZ",
		material: "POLE CLAMP",
		unit: "EA",
		qty: 5,
	},
]
const groups = [
	{
		brigadeId: "b1",
		brigadeName: "ANGEL D JIMENEZ",
		brigadeCode: "124",
		signers: [{ key: "b1:name", name: "Edgard Ocasio" }],
	},
]

// Same loose typing the other component tests use for the stub fixture.
const mount = (renderStub: any, action = vi.fn(async () => null)) =>
	renderStub({
		entries: [
			{
				path: "/",
				action: async ({ request }: { request: Request }) =>
					action(Object.fromEntries(await request.formData()) as never),
				Component: () => (
					<RestockHandOver
						id="r1"
						lines={lines}
						warehouseUsers={[{ id: "wh-1", name: "Orlando" }]}
						signerGroups={groups}
					/>
				),
			},
		],
	})

describe("RestockHandOver", () => {
	it("gives what was asked by default, with no note box until it is short", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		expect(screen.getByLabelText("Given")).toHaveValue(5)
		expect(screen.queryByPlaceholderText("Note if short")).toBeNull()
		await userEvent.fill(screen.getByLabelText("Given"), "4")
		expect(screen.getByPlaceholderText("Note if short")).toBeInTheDocument()
	})

	it("will not sign a short line without a note, and sends nothing", async ({
		renderStub,
	}) => {
		const action = vi.fn(async () => null)
		await mount(renderStub, action)
		await userEvent.fill(screen.getByLabelText("Given"), "4")
		await userEvent.click(
			screen.getByRole("button", { name: "Sign and close" }),
		)
		expect(
			screen.getByText(/Add a note to every line that is short/),
		).toBeInTheDocument()
		expect(action).not.toHaveBeenCalled()
	})

	it("will not give more than was asked", async ({ renderStub }) => {
		await mount(renderStub)
		await userEvent.fill(screen.getByLabelText("Given"), "6")
		await userEvent.click(
			screen.getByRole("button", { name: "Sign and close" }),
		)
		expect(
			screen.getByText(/whole number from 0 up to what was asked/),
		).toBeInTheDocument()
	})

	it("asks for the signatures once the quantities are fine", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		await userEvent.click(
			screen.getByRole("button", { name: "Sign and close" }),
		)
		// One warehouse user and one crew signer are preselected; the pads are empty.
		expect(
			screen.getByText("Warehouse release signature is required."),
		).toBeInTheDocument()
	})
})
