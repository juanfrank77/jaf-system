import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Badge } from "./badge"

describe("Badge", () => {
	it("renders its label", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{ path: "/", Component: () => <Badge variant="ok">Closed</Badge> },
			],
		})
		expect(screen.getByText("Closed")).toBeInTheDocument()
	})

	it("resolves a non-transparent background from the status token", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{ path: "/", Component: () => <Badge variant="danger">Flagged</Badge> },
			],
		})
		const el = screen.getByText("Flagged")
		const bg = getComputedStyle(el).backgroundColor
		expect(bg).not.toBe("")
		expect(bg).not.toBe("rgba(0, 0, 0, 0)")
		expect(bg).not.toBe("transparent")
	})

	it("defaults to the neutral variant", async ({ renderStub }) => {
		await renderStub({
			entries: [{ path: "/", Component: () => <Badge>Draft</Badge> }],
		})
		expect(screen.getByText("Draft")).toHaveAttribute("data-variant", "neutral")
	})
})
