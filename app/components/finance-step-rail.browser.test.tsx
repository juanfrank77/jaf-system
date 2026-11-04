import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FINANCE_STEP_HREF } from "~/lib/finance-steps"
import { ArmBStepRail, FinanceStepRail, StageChip } from "./finance-step-rail"

describe("finance step rails", () => {
	it("gives every Arm A step its own screen", () => {
		expect(new Set(Object.values(FINANCE_STEP_HREF)).size).toBe(3)
	})

	it("renders the three Arm A steps and the Closed marker, with distinct hrefs", async ({
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
		// Closed is where Arm A ends, not a screen.
		expect(items[3].dataset.state).toBe("locked")
		const links = screen.getAllByRole("link")
		expect(links).toHaveLength(2)
		const hrefs = links.map((a) => a.getAttribute("href"))
		expect(hrefs).toContain("/finance/queue")
		expect(hrefs).toContain("/finance/payroll")
	})

	it("links the other two Arm B steps from the current one", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{ path: "/", Component: () => <ArmBStepRail current="RECEIVABLES" /> },
			],
		})
		const items = await screen.findAllByRole("listitem")
		expect(items).toHaveLength(3)
		expect(
			screen.getAllByRole("link").map((a) => a.getAttribute("href")),
		).toEqual(["/finance/awaiting-po", "/finance/awaiting-ariba"])
		expect(items.filter((li) => li.dataset.state === "locked")).toHaveLength(0)
	})

	it("marks the current Arm B step as current and links the rest", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{ path: "/", Component: () => <ArmBStepRail current="AWAITING_PO" /> },
			],
		})
		const items = await screen.findAllByRole("listitem")
		expect(items).toHaveLength(3)
		expect(items[0].dataset.state).toBe("current")
		expect(items[0].getAttribute("aria-current")).toBe("step")
		expect(items[1].dataset.state).not.toBe("locked")
		expect(items[2].dataset.state).not.toBe("locked")
		expect(
			screen.getAllByRole("link").map((a) => a.getAttribute("href")),
		).toEqual(["/finance/awaiting-ariba", "/finance/receivables"])
	})

	it("renders the stage chips", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<>
							<StageChip arm="A" step={3} total={3} />
							<StageChip arm="B" name="Receivables" />
						</>
					),
				},
			],
		})
		expect(await screen.findByText("Arm A · Stage 3 of 3")).toBeInTheDocument()
		expect(screen.getByText("Arm B · Receivables")).toBeInTheDocument()
	})
})
