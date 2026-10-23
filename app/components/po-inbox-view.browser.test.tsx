import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PoInboxView } from "./po-inbox-view"

const counts = {
	reading: 2,
	ready: 1,
	needsLook: 1,
	blocked: 0,
	unmatched: 0,
	confirmed: 0,
	uploadedToday: 3,
}

describe("PoInboxView", () => {
	it("shows the tabs with counts, the reading note and the green-only button", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<PoInboxView
							counts={counts}
							tab="needs_look"
							rows={[
								{
									id: "p1",
									fileName: "p1.pdf",
									poNumber: "4500526054",
									poDate: null,
									avisoNumber: "10343504",
									total: 894.03,
									checks: [
										{
											code: "ivu_line",
											severity: "needs_look",
											detail: "line 2",
										},
									],
									readError: null,
								},
							]}
						/>
					),
				},
			],
		})
		expect(await screen.findByText("3 POs uploaded today")).toBeInTheDocument()
		expect(screen.getByText("Reading 2 POs…")).toBeInTheDocument()
		expect(
			screen.getByRole("button", { name: "Confirm all green (1)" }),
		).toBeEnabled()
		expect(screen.getByText("4500526054")).toBeInTheDocument()
		// Rule 4: a missing date shows as Missing, not blank.
		expect(screen.getByText("Missing")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Fix" })).toHaveAttribute(
			"href",
			"/finance/awaiting-po/p1",
		)
	})
})
