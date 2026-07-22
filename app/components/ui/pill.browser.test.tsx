import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Pill } from "./pill"

describe("Pill", () => {
	it("renders its message", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<Pill variant="warn">3 documents waiting on your prep</Pill>
					),
				},
			],
		})
		expect(
			screen.getByText("3 documents waiting on your prep"),
		).toBeInTheDocument()
	})

	it("renders an optional icon", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<Pill variant="info" icon={<span data-testid="icon">i</span>}>
							Heads up
						</Pill>
					),
				},
			],
		})
		expect(screen.getByTestId("icon")).toBeInTheDocument()
	})
})
