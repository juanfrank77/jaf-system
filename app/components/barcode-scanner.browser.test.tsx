import { screen } from "@testing-library/react"
import { it } from "vitest"
import { BarcodeScanner } from "./barcode-scanner"

it("renders a scan surface and a manual give-up control", async ({
	renderStub,
}) => {
	await renderStub({
		entries: [
			{
				path: "/",
				Component: () => (
					<BarcodeScanner
						onDecode={() => {}}
						onGiveUp={() => {}}
						maxAttempts={2}
					/>
				),
			},
		],
	})
	await screen.findByRole("button", { name: /can't scan/i })
})
