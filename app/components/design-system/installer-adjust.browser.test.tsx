import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import {
	clickWhenReady,
	fillWhenReady,
} from "../../../tests/browser-test-utils"
import { InstallerAdjustV2 } from "./installer-adjust"

const rows = [
	{
		serviceCodeId: "sc-a",
		claroCode: "111",
		name: "Item A",
		onHand: 10,
		standard: 5,
		delta: 5,
	},
	{
		serviceCodeId: "sc-b",
		claroCode: "222",
		name: "Item B",
		onHand: 8,
		standard: 5,
		delta: 3,
	},
]

const parStatus = {
	hasParLevels: true,
	belowParCount: 0,
}

describe("InstallerAdjustV2", () => {
	it("posts only the second row after switching with discard", async ({
		renderStub,
	}) => {
		let posted: { serviceCodeId: string | null; qty: string | null } | null =
			null

		await renderStub({
			entries: [
				{
					path: "/",
					action: async ({ request }) => {
						const form = await request.formData()
						posted = {
							serviceCodeId: form.get("serviceCodeId") as string | null,
							qty: form.get("qty") as string | null,
						}
						return null
					},
					Component: () => (
						<InstallerAdjustV2
							van={{ id: "van-1", name: "Van 444" }}
							comparison={rows}
							parLevels={[
								{ serviceCodeId: "sc-a", parLevel: 5 },
								{ serviceCodeId: "sc-b", parLevel: 5 },
							]}
							parStatus={parStatus}
							hasPendingRestock={false}
							errorKey={null}
						/>
					),
				},
			],
		})

		const adjustButtons = screen.getAllByRole("button", { name: /Adjust/i })
		await userEvent.click(adjustButtons[0])
		await userEvent.fill(screen.getByLabelText(/Qty removed from van/i), "2")

		await userEvent.click(adjustButtons[1])
		await waitFor(() => {
			expect(screen.getByText(/Discard changes/i)).toBeInTheDocument()
		})
		await clickWhenReady(() =>
			screen.getByRole("button", { name: /^Discard$/i }),
		)

		await fillWhenReady(
			() => screen.getByLabelText(/Qty removed from van/i),
			"3",
		)
		await fillWhenReady(
			() => screen.getByLabelText(/^Reason$/i),
			"Damaged in transit",
		)

		const submit = screen.getByRole("button", { name: /Report Adjustment/i })
		expect(submit).not.toBeDisabled()
		await userEvent.click(submit)

		await waitFor(() => {
			expect(posted).toEqual({ serviceCodeId: "sc-b", qty: "3" })
		})
	})
})
