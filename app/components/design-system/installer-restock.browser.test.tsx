import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { InstallerRestockV2 } from "./installer-restock"

const comparison = [
	{
		serviceCodeId: "sc-1",
		claroCode: "111",
		name: "Cable",
		onHand: 2,
		standard: 5,
		delta: -3,
	},
]

describe("InstallerRestockV2 gate", () => {
	it("enables submit only when warehouse and qty are valid", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<InstallerRestockV2
							van={{ id: "van-1", name: "Van 444" }}
							warehouses={[{ id: "wh-1", name: "Guaynabo" }]}
							comparison={comparison}
							parStatus={{ hasParLevels: true, belowParCount: 1 }}
							hasPendingRestock={false}
							pendingRequestCount={0}
							restockRequests={[]}
							errorKey={null}
						/>
					),
				},
			],
		})

		const submit = screen.getByRole("button", {
			name: /Submit Restock Request/i,
		})
		expect(submit).toBeDisabled()

		await userEvent.selectOptions(screen.getByLabelText(/Warehouse/i), "wh-1")
		expect(submit).toBeDisabled()

		await userEvent.fill(screen.getByLabelText(/Qty for Cable/i), "2")

		await waitFor(() => {
			expect(submit).toBeEnabled()
		})
	})
})

describe("InstallerRestockV2 submit", () => {
	it("does not post twice when submit is clicked during an in-flight request", async ({
		renderStub,
	}) => {
		let postCount = 0

		await renderStub({
			entries: [
				{
					path: "/",
					action: async () => {
						postCount += 1
						await new Promise((resolve) => setTimeout(resolve, 400))
						return null
					},
					Component: () => (
						<InstallerRestockV2
							van={{ id: "van-1", name: "Van 444" }}
							warehouses={[{ id: "wh-1", name: "Guaynabo" }]}
							comparison={comparison}
							parStatus={{ hasParLevels: true, belowParCount: 1 }}
							hasPendingRestock={false}
							pendingRequestCount={0}
							restockRequests={[]}
							errorKey={null}
						/>
					),
				},
			],
		})

		await userEvent.selectOptions(screen.getByLabelText(/Warehouse/i), "wh-1")
		await userEvent.fill(screen.getByLabelText(/Qty for Cable/i), "2")

		const submit = screen.getByRole("button", {
			name: /Submit Restock Request/i,
		})
		await waitFor(() => {
			expect(submit).toBeEnabled()
		})

		await userEvent.click(submit)

		const sending = await waitFor(() => {
			const button = screen.getByRole("button", { name: /Sending/i })
			expect(button).toBeDisabled()
			return button
		})

		// Disabled submit cannot receive a second pointer click.
		expect(sending).toBeDisabled()

		await waitFor(() => {
			expect(postCount).toBe(1)
		})
	})
})
