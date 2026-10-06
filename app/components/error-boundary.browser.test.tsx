import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RouteErrorBoundary } from "./error-boundary"

const mount = (renderStub: any, error: unknown, lng?: "en" | "es") =>
	renderStub({
		entries: [
			{ path: "/", Component: () => <RouteErrorBoundary error={error} /> },
		],
		i18n: lng ? { lng } : undefined,
	})

// react-router hands the boundary an ErrorResponse-shaped object.
const errorResponse = (status: number, data: string) =>
	Object.assign(Object.create(null), {
		status,
		statusText: "",
		data,
		internal: true,
	})

describe("RouteErrorBoundary", () => {
	it("explains a reassignment instead of a plain 404", async ({
		renderStub,
	}) => {
		await mount(renderStub, errorResponse(404, "NOT_ASSIGNED"))
		expect(
			screen.getByRole("heading", { name: "This job isn't assigned to you" }),
		).toBeInTheDocument()
		expect(screen.getByText(/reassigned to another crew/)).toBeInTheDocument()
		expect(screen.queryByText("Page Not Found!")).not.toBeInTheDocument()
	})

	it("localizes the reassignment message to Spanish", async ({
		renderStub,
	}) => {
		await mount(renderStub, errorResponse(404, "NOT_ASSIGNED"), "es")
		expect(
			screen.getByRole("heading", { name: "No tienes asignado este trabajo" }),
		).toBeInTheDocument()
	})

	it("keeps the plain 404 for any other not-found", async ({ renderStub }) => {
		await mount(renderStub, errorResponse(404, "Not Found"))
		expect(screen.getByText("Page Not Found!")).toBeInTheDocument()
	})
})
