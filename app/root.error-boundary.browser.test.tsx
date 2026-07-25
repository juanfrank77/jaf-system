import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ErrorBoundary } from "./root"

describe("root ErrorBoundary", () => {
	it("shows the 404 copy for a 404 route error response", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					loader: () => {
						throw new Response(null, { status: 404 })
					},
					Component: () => <p>unreachable</p>,
					ErrorBoundary,
				},
			],
		})
		expect(screen.getByText("Page Not Found!")).toBeInTheDocument()
		expect(
			screen.getByText("The page you're looking for doesn't exist."),
		).toBeInTheDocument()
	})

	it("shows the generic error copy for a non-404 route error response", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					loader: () => {
						throw new Response(null, { status: 500, statusText: "" })
					},
					Component: () => <p>unreachable</p>,
					ErrorBoundary,
				},
			],
		})
		expect(screen.getByText("Error")).toBeInTheDocument()
		expect(
			screen.getByText("An unexpected error occurred on the server."),
		).toBeInTheDocument()
	})
})
