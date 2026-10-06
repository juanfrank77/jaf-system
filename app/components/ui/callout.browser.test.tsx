import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Callout } from "./callout"

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

describe("Callout", () => {
	it("renders a bold title followed by the body", async ({ renderStub }) => {
		await mount(
			renderStub,
			<Callout title="Step 2 of 6 · You">Check the photos.</Callout>,
		)
		const title = screen.getByText("Step 2 of 6 · You")
		expect(title.tagName).toBe("B")
		expect(screen.getByText(/Check the photos\./)).toBeInTheDocument()
	})

	it("defaults to the info tone", async ({ renderStub }) => {
		await mount(renderStub, <Callout title="T">body</Callout>)
		expect(screen.getByText("T").closest('[data-slot="pill"]')).toHaveClass(
			"bg-status-info-soft",
		)
	})

	it("renders the warn tone", async ({ renderStub }) => {
		await mount(
			renderStub,
			<Callout title="T" tone="warn">
				body
			</Callout>,
		)
		expect(screen.getByText("T").closest('[data-slot="pill"]')).toHaveClass(
			"bg-status-warn-soft",
		)
	})
})
