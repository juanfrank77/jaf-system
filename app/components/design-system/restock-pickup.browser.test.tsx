import { screen, waitFor } from "@testing-library/react"
import { forwardRef, useImperativeHandle, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { RestockPickupV2 } from "./restock-pickup"

vi.mock("~/components/signature-pad", () => ({
	SignaturePad: forwardRef<
		{ isEmpty: () => boolean; clear: () => void; toDataURL: () => string },
		{ onEnd?: () => void; ariaLabel?: string }
	>(function MockSignaturePad({ onEnd, ariaLabel }, ref) {
		const [signed, setSigned] = useState(false)
		useImperativeHandle(ref, () => ({
			isEmpty: () => !signed,
			clear: () => {
				setSigned(false)
			},
			toDataURL: () => (signed ? "data:image/png;base64,abc" : "data:,"),
		}))
		return (
			<button
				type="button"
				aria-label={ariaLabel}
				onClick={() => {
					setSigned(true)
					queueMicrotask(() => onEnd?.())
				}}
			>
				Sign {ariaLabel}
			</button>
		)
	}),
}))

const lines = [
	{
		serviceCodeId: "sc-1",
		claroCode: "111",
		name: "Cable",
		approvedQty: 3,
	},
]

describe("RestockPickupV2 signatures", () => {
	it("keeps confirm disabled until both pads are signed", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<RestockPickupV2
							requestId="req-abcdef"
							warehouseName="Guaynabo"
							lines={lines}
							errorKey={null}
						/>
					),
				},
			],
		})

		const confirm = screen.getByRole("button", { name: /Confirm Pickup/i })
		expect(confirm).toBeDisabled()

		await userEvent.click(
			screen.getByRole("button", { name: /Warehouse signature/i }),
		)
		expect(confirm).toBeDisabled()

		await userEvent.click(
			screen.getByRole("button", { name: /Installer signature/i }),
		)

		await waitFor(() => {
			expect(confirm).toBeEnabled()
		})
	})
})
