import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { DesignSystemAppShell } from "./app-shell"

describe("DesignSystemAppShell mobile drawer", () => {
	it("opens, closes on Escape, and returns focus to the menu trigger", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<DesignSystemAppShell
							user={{ id: "user-1", name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[]}
							comptrollerEnabled={false}
							theme="light"
						>
							<p>body</p>
						</DesignSystemAppShell>
					),
				},
			],
		})

		const menuButton = screen.getByRole("button", {
			name: "Open navigation menu",
		})
		await userEvent.click(menuButton)

		const dialog = screen.getByRole("dialog", { name: "Navigation" })
		expect(dialog).toBeVisible()

		await userEvent.keyboard("{Escape}")

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull()
		})
		expect(menuButton).toHaveFocus()
	})
})
