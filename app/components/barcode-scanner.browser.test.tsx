import { render, screen } from "@testing-library/react"
import { expect, it } from "vitest"
import { BarcodeScanner } from "./barcode-scanner"

it("renders a scan surface and a manual give-up control", () => {
	render(
		<BarcodeScanner onDecode={() => {}} onGiveUp={() => {}} maxAttempts={2} />,
	)
	expect(
		screen.getByRole("button", { name: /can't scan/i }),
	).toBeInTheDocument()
})
