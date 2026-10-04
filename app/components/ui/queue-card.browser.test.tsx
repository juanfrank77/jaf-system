import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { QueueCard } from "./queue-card"

describe("QueueCard", () => {
	it("shows the title, count badge and children when non-empty", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<QueueCard
							title="Pending review"
							count={2}
							variant="warn"
							empty="Nothing here"
						>
							<p>rows</p>
						</QueueCard>
					),
				},
			],
		})
		expect(
			screen.getByRole("heading", { name: "Pending review" }),
		).toBeInTheDocument()
		expect(screen.getByText("2")).toBeInTheDocument()
		expect(screen.getByText("rows")).toBeInTheDocument()
		expect(screen.queryByText("Nothing here")).not.toBeInTheDocument()
	})

	it("shows the empty message instead of children at count 0", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<QueueCard
							title="Blocked"
							count={0}
							variant="danger"
							empty="Nothing here"
						>
							<p>rows</p>
						</QueueCard>
					),
				},
			],
		})
		expect(screen.getByText("Nothing here")).toBeInTheDocument()
		expect(screen.queryByText("rows")).not.toBeInTheDocument()
	})
})
