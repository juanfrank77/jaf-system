import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { type MaterialCode, ReceivePanel } from "./receive-panel"

const materialCodes: MaterialCode[] = [
	{
		id: "sc-1",
		claroCode: "34006428",
		name: "SPLICE ENCLOSURE",
		unit: "EA",
		unitPrice: 12.5,
	},
]

describe("ReceivePanel", () => {
	it("posts to the receive action and shows the success message", async ({
		renderStub,
	}) => {
		const posted: { form: FormData | null } = { form: null }
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<ReceivePanel warehouseId="wh-1" materialCodes={materialCodes} />
					),
				},
				{
					path: "/warehouse/stock/receive",
					action: async ({ request }) => {
						posted.form = await request.formData()
						return { ok: true }
					},
					Component: () => null,
				},
			],
		})

		await userEvent.type(screen.getByLabelText("Reference (optional)"), "PO-42")
		await userEvent.click(
			screen.getByRole("button", { name: "Record delivery" }),
		)

		await waitFor(() => {
			expect(screen.getByText("Delivery recorded.")).toBeInTheDocument()
		})
		expect(posted.form?.get("warehouseId")).toBe("wh-1")
		expect(posted.form?.get("reference")).toBe("PO-42")
		// Review finding E: the receive action had no idempotency key at all, so
		// a double submit double-counted bulk on-hand. The panel must supply one.
		expect(posted.form?.get("idempotencyKey")).toBeTruthy()
	})
})
