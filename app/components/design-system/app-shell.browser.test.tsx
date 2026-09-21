import { screen, waitFor, within } from "@testing-library/react"
import { useLocation } from "react-router"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { DesignSystemAppShell } from "./app-shell"

function RoutePath() {
	const { pathname } = useLocation()
	return <span data-testid="route-path">{pathname}</span>
}

function shellFixture({
	theme = "light",
	role = "SUPERVISOR" as const,
}: {
	theme?: "light" | "dark"
	role?: "SUPERVISOR" | "INSTALLER"
} = {}) {
	return (
		<DesignSystemAppShell
			user={{ id: "user-1", name: "Jose Alfaro", role }}
			notifications={[]}
			comptrollerEnabled={false}
			theme={theme}
		>
			<p>body</p>
		</DesignSystemAppShell>
	)
}

describe("DesignSystemAppShell mobile drawer", () => {
	it("opens, closes on Escape, and returns focus to the menu trigger", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [{ path: "/", Component: () => shellFixture() }],
		})

		const menuButton = screen.getByRole("button", {
			name: "Open navigation menu",
		})
		await userEvent.click(menuButton)

		expect(screen.getByRole("dialog", { name: "Navigation" })).toBeVisible()

		await userEvent.keyboard("{Escape}")

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull()
		})
		expect(menuButton).toHaveFocus()
	})

	it("closes when a nav link inside the drawer is clicked", async ({
		renderStub,
	}) => {
		await renderStub({
			props: { initialEntries: ["/"] },
			entries: [
				{
					path: "/",
					Component: () => shellFixture(),
					children: [{ path: "dashboard", Component: () => <p>dashboard</p> }],
				},
			],
		})

		await userEvent.click(
			screen.getByRole("button", { name: "Open navigation menu" }),
		)
		const drawer = screen.getByRole("dialog", { name: "Navigation" })
		await userEvent.click(
			within(drawer).getByRole("link", { name: "Dashboard" }),
		)
		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull()
		})
	})
})

describe("DesignSystemAppShell notifications popover", () => {
	it("closes on Escape and returns focus to the bell trigger", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [{ path: "/", Component: () => shellFixture() }],
		})

		const bell = screen.getByRole("button", { name: "Notifications" })
		await userEvent.click(bell)
		expect(screen.getByText("No new notifications")).toBeInTheDocument()

		await userEvent.keyboard("{Escape}")

		await waitFor(() => {
			expect(screen.queryByText("No new notifications")).not.toBeInTheDocument()
		})
		expect(bell).toHaveFocus()
	})
})

describe("DesignSystemAppShell theme toggle", () => {
	it("updates theme without changing the URL", async ({ renderStub }) => {
		let persistedTheme: "light" | "dark" = "light"
		const startPath = "/installer"

		await renderStub({
			props: { initialEntries: [startPath] },
			entries: [
				{
					path: startPath,
					Component: () => (
						<>
							<RoutePath />
							{shellFixture({ role: "INSTALLER" })}
						</>
					),
				},
				{
					path: "/account",
					action: async ({ request }) => {
						const form = await request.formData()
						if (form.get("intent") === "updateTheme") {
							persistedTheme = form.get("theme") === "dark" ? "dark" : "light"
							return { theme: persistedTheme }
						}
						return { errorKey: "account.errors.name_required" }
					},
					Component: () => null,
				},
			],
		})

		await userEvent.click(
			screen.getByRole("button", { name: "Open navigation menu" }),
		)
		const drawer = screen.getByRole("dialog", { name: "Navigation" })
		await userEvent.click(within(drawer).getByRole("button", { name: "Dark" }))

		await waitFor(() => {
			expect(document.documentElement.classList.contains("dark")).toBe(true)
		})
		expect(screen.getByTestId("route-path")).toHaveTextContent(startPath)
		expect(persistedTheme).toBe("dark")

		await renderStub({
			props: { initialEntries: [startPath] },
			entries: [
				{
					path: startPath,
					Component: () => (
						<>
							<RoutePath />
							{shellFixture({ role: "INSTALLER", theme: "dark" })}
						</>
					),
				},
			],
		})

		expect(
			screen.getAllByRole("button", { name: "Light" }).length,
		).toBeGreaterThan(0)
	})
})
