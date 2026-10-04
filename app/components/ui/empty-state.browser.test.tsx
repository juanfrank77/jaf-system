import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { EmptyState } from "./empty-state"

describe("EmptyState", () => {
	it("renders its message", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => <EmptyState>No documents yet.</EmptyState>,
				},
			],
		})
		expect(screen.getByText("No documents yet.")).toBeInTheDocument()
	})
})
