import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { InstallerLoopRail } from "./installer-loop-rail"

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({
		entries: [
			{
				path: "/",
				Component: () => <div style={{ width: 358 }}>{ui}</div>,
			},
		],
	})

describe("InstallerLoopRail", () => {
	it("is one row of five unnumbered, 44px-tall steps at phone width", async ({
		renderStub,
	}) => {
		await mount(renderStub, <InstallerLoopRail current="SWAP" />)
		const items = within(screen.getByRole("list")).getAllByRole("listitem")
		expect(items.map((i) => i.textContent)).toEqual([
			"Home",
			"New job",
			"Swap",
			"My van",
			"Restock",
		])
		const tops = new Set(
			items.map((i) => Math.round(i.getBoundingClientRect().top)),
		)
		expect(tops.size).toBe(1)
		for (const i of items) {
			expect(i.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
			// No label is cut off.
			expect(i.scrollWidth).toBeLessThanOrEqual(i.clientWidth)
		}
	})
})
