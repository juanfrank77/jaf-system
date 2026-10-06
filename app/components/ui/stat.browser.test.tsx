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

	it("renders a sub-line under the value", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => <Stat label="Overdue" value={3} sub="oldest 18 d" />,
				},
			],
		})
		expect(screen.getByText("oldest 18 d")).toBeInTheDocument()
	})

	it("is neutral by default and tints for warn and flag", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<div>
							<Stat label="A" value={1} />
							<Stat label="B" value={2} tone="warn" />
							<Stat label="C" value={3} tone="flag" />
						</div>
					),
				},
			],
		})
		const tone = (label: string) =>
			screen.getByText(label).closest('[data-slot="stat"]')
		expect(tone("A")).toHaveAttribute("data-tone", "neutral")
		expect(tone("B")).toHaveAttribute("data-tone", "warn")
		expect(tone("B")).toHaveClass("bg-status-warn-soft")
		expect(tone("C")).toHaveAttribute("data-tone", "flag")
		expect(tone("C")).toHaveClass("bg-status-danger-soft")
	})

	it("becomes a link when href is given", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => <Stat label="Open" value={4} href="/queue" />,
				},
			],
		})
		const link = screen.getByRole("link", { name: /Open/ })
		expect(link).toHaveAttribute("href", expect.stringMatching(/\/queue$/))
		expect(link).toHaveAttribute("data-slot", "stat")
	})

	it("is not a link without href", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{ path: "/", Component: () => <Stat label="Open" value={4} /> },
			],
		})
		expect(screen.queryByRole("link")).not.toBeInTheDocument()
	})
})
