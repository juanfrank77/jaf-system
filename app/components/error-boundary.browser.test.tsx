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
	it("shows the plain 404 for a not-found", async ({ renderStub }) => {
		await mount(renderStub, errorResponse(404, "Not Found"))
		expect(screen.getByText("Page Not Found!")).toBeInTheDocument()
	})
})
