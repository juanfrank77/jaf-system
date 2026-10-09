import { screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { type CapturedPhoto, PhotoCapture } from "./photo-capture"

function Harness() {
	const [photos, setPhotos] = useState<CapturedPhoto[]>([])
	return <PhotoCapture photos={photos} onChange={setPhotos} tag="BEFORE" />
}

describe("PhotoCapture", () => {
	it("adds a thumbnail per shot and removes it", async ({ renderStub }) => {
		const { container } = (await renderStub({
			entries: [{ path: "/", Component: Harness }],
		})) as unknown as { container: HTMLElement }
		void container
		const input = document.querySelector(
			'input[type="file"]',
		) as HTMLInputElement
		expect(input.getAttribute("capture")).toBe("environment")
		const png = Uint8Array.from(
			atob(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
			),
			(c) => c.charCodeAt(0),
		)
		await userEvent.upload(
			input,
			new File([png], "a.png", { type: "image/png" }),
		)
		expect(screen.getByText("BEFORE")).toBeInTheDocument()
		await userEvent.click(screen.getByLabelText("Remove photo"))
		expect(screen.queryByText("BEFORE")).not.toBeInTheDocument()
	})
})
