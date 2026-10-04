import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PageHeader } from "./page-header"

describe("PageHeader", () => {
	it("renders the title as an h1 with optional description and actions", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<PageHeader
							title="Dashboard"
							description="What needs you"
							actions={<button type="button">Go</button>}
						/>
					),
				},
			],
		})
		expect(
			screen.getByRole("heading", { level: 1, name: "Dashboard" }),
		).toBeInTheDocument()
		expect(screen.getByText("What needs you")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument()
	})
})
