import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FINANCE_STEP_HREF } from "~/lib/finance-steps"
import { ArmBStepRail, FinanceStepRail, StageChip } from "./finance-step-rail"

describe("finance step rails", () => {
	it("gives every Arm A step its own screen", () => {
		expect(new Set(Object.values(FINANCE_STEP_HREF)).size).toBe(5)
	})

	it("renders the five Arm A steps with distinct hrefs", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{ path: "/", Component: () => <FinanceStepRail current="LC_FUNDED" /> },
			],
		})
		expect(await screen.findAllByRole("listitem")).toHaveLength(5)
		const links = screen.getAllByRole("link")
		expect(links).toHaveLength(4)
		const hrefs = links.map((a) => a.getAttribute("href"))
		expect(new Set(hrefs).size).toBe(4)
		expect(hrefs).toContain("/finance/queue")
		expect(hrefs).toContain("/finance/awaiting-carmen")
	})

	it("locks PO inbox and Claro invoices on the Arm B rail", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{ path: "/", Component: () => <ArmBStepRail current="RECEIVABLES" /> },
			],
		})
		const items = await screen.findAllByRole("listitem")
		expect(items).toHaveLength(3)
		expect(screen.queryAllByRole("link")).toHaveLength(0)
		expect(items.filter((li) => li.dataset.state === "locked")).toHaveLength(2)
	})

	it("marks the current Arm B step as current even when it is unavailable", async ({
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
		expect(items[1].dataset.state).toBe("locked")
		expect(items[2].dataset.state).not.toBe("locked")
		expect(screen.getAllByRole("link")).toHaveLength(1)
		expect(screen.getByRole("link").getAttribute("href")).toBe(
			"/finance/receivables",
		)
	})

	it("renders the stage chips", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<>
							<StageChip arm="A" step={3} total={5} />
							<StageChip arm="B" name="Receivables" />
						</>
					),
				},
			],
		})
		expect(await screen.findByText("Arm A · Stage 3 of 5")).toBeInTheDocument()
		expect(screen.getByText("Arm B · Receivables")).toBeInTheDocument()
	})
})
