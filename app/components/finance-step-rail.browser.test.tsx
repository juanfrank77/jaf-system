import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FINANCE_STEP_HREF } from "~/lib/finance-steps"
import { FinanceStepRail, StageChip } from "./finance-step-rail"

describe("finance step rails", () => {
	it("gives every Arm A step its own screen", () => {
		expect(new Set(Object.values(FINANCE_STEP_HREF)).size).toBe(3)
	})

	it("renders the three Arm A steps and Closed, with distinct hrefs", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => <FinanceStepRail current="LC_REQUEST" />,
				},
			],
		})
		const items = await screen.findAllByRole("listitem")
		expect(items).toHaveLength(4)
		// Closed is where Arm A ends, and it has its own screen.
		expect(items[3].dataset.state).toBe("todo")
		const links = screen.getAllByRole("link")
		expect(links).toHaveLength(3)
		const hrefs = links.map((a) => a.getAttribute("href"))
		expect(hrefs).toContain("/finance/queue")
		expect(hrefs).toContain("/finance/payroll")
		expect(hrefs).toContain("/finance/closed")
	})

	it("renders the stage chip", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => <StageChip arm="A" step={3} total={3} />,
				},
			],
		})
		expect(await screen.findByText("Arm A · Stage 3 of 3")).toBeInTheDocument()
	})
})
