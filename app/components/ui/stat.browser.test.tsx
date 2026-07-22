import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Stat } from "./stat"

describe("Stat", () => {
	it("renders label and value", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{ path: "/", Component: () => <Stat label="Open docs" value={7} /> },
			],
		})
		expect(screen.getByText("Open docs")).toBeInTheDocument()
		expect(screen.getByText("7")).toBeInTheDocument()
	})
})
