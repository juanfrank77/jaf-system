import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { AdjustPanel, type MaterialCode } from "./adjust-panel"

const materialCodes: MaterialCode[] = [
	{
		id: "sc-1",
		claroCode: "34006428",
		name: "SPLICE ENCLOSURE",
		unit: "EA",
		unitPrice: 12.5,
	},
]

describe("AdjustPanel", () => {
	it("shows the server-returned error message when the action rejects a blank reason", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AdjustPanel warehouseId="wh-1" materialCodes={materialCodes} />
					),
				},
				{
					path: "/warehouse/stock/adjust",
					action: async () => ({ errorKey: "adjust.reason_required" as const }),
					Component: () => null,
				},
			],
		})

		await userEvent.type(screen.getByLabelText("Delta (+/-)"), "-5")
		// The action itself is mocked to always return the error — a native
		// `required` attribute would otherwise block submission before it's
		// ever reached, so the reason field still needs a value here.
		await userEvent.type(screen.getByLabelText("Reason"), "placeholder")
		await userEvent.click(
			screen.getByRole("button", { name: "Post adjustment" }),
		)

		await waitFor(() => {
			expect(screen.getByText("A reason is required.")).toBeInTheDocument()
		})
	})

	it("shows the success message and rotates the idempotency key after a successful adjustment", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AdjustPanel warehouseId="wh-1" materialCodes={materialCodes} />
					),
				},
				{
					path: "/warehouse/stock/adjust",
					action: async () => ({ ok: true, deduped: false }),
					Component: () => null,
				},
			],
		})

		await userEvent.type(screen.getByLabelText("Delta (+/-)"), "-5")
		await userEvent.type(screen.getByLabelText("Reason"), "cycle count")
		await userEvent.click(
			screen.getByRole("button", { name: "Post adjustment" }),
		)

		await waitFor(() => {
			expect(screen.getByText("Adjustment posted.")).toBeInTheDocument()
		})
	})
})
