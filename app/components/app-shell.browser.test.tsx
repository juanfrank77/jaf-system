import { screen, waitFor, within } from "@testing-library/react"
import { Outlet } from "react-router"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { AppShell } from "./app-shell"

describe("AppShell", () => {
	it("shows the user's name and role", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		const header = screen.getByRole("banner")
		expect(within(header).getByText("Jose Alfaro")).toBeInTheDocument()
		expect(screen.getByText("SUPERVISOR")).toBeInTheDocument()
	})

	it("shows the theme toggle and no J badge in the header", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		const header = screen.getByRole("banner")
		expect(
			within(header).getByRole("button", { name: /^Theme:/ }),
		).toBeInTheDocument()
		expect(within(header).queryByText("J")).not.toBeInTheDocument()
	})

	it("renders children in the main content slot", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[]}
						>
							<p>dashboard body</p>
						</AppShell>
					),
				},
			],
		})
		expect(screen.getByText("dashboard body")).toBeInTheDocument()
	})

	it("shows + New Document for SUPERVISOR but not Admin links", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		expect(
			screen.getByRole("link", { name: "+ New Document", hidden: true }),
		).toBeInTheDocument()
		expect(
			screen.queryByRole("link", { name: "Admin Settings", hidden: true }),
		).not.toBeInTheDocument()
		expect(
			screen.queryByRole("link", { name: "Receivables", hidden: true }),
		).not.toBeInTheDocument()
	})

	it("shows only Dashboard for CREW", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "L. Rivera", role: "CREW" }}
							notifications={[]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		expect(
			screen.getByRole("link", { name: "Dashboard", hidden: true }),
		).toBeInTheDocument()
		expect(
			screen.queryByRole("link", { name: "+ New Document", hidden: true }),
		).not.toBeInTheDocument()
		expect(
			screen.queryByRole("link", { name: "Receivables", hidden: true }),
		).not.toBeInTheDocument()
		expect(
			screen.queryByRole("link", { name: "Admin Settings", hidden: true }),
		).not.toBeInTheDocument()
	})

	it("hides the Comptroller nav item when the feature flag is off", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Monica García", role: "ADMIN" }}
							notifications={[]}
							comptrollerEnabled={false}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		expect(
			screen.queryByRole("link", { name: "Comptroller", hidden: true }),
		).not.toBeInTheDocument()
	})

	it("shows the Comptroller nav item when the feature flag is on", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Monica García", role: "ADMIN" }}
							notifications={[]}
							comptrollerEnabled={true}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		expect(
			screen.getByRole("link", { name: "Comptroller", hidden: true }),
		).toBeInTheDocument()
	})

	it("shows every nav item for ADMIN", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Monica García", role: "ADMIN" }}
							notifications={[]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		expect(
			screen.getByRole("link", { name: "Dashboard", hidden: true }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("link", { name: "+ New Document", hidden: true }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("link", { name: "Finance Pipeline", hidden: true }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("link", { name: "Admin Settings", hidden: true }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("link", { name: "Catalog", hidden: true }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("link", { name: "Users", hidden: true }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("link", { name: "Crews", hidden: true }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("link", { name: "Vans", hidden: true }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("link", { name: "Installer", hidden: true }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("link", {
				name: "Installer Supervisor",
				hidden: true,
			}),
		).toBeInTheDocument()
		expect(
			screen.getByRole("link", { name: "Scan In Return", hidden: true }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("link", {
				name: "Restocks to Release",
				hidden: true,
			}),
		).toBeInTheDocument()
	})

	it("shows the unread notification count", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[
								{
									id: "1",
									message: "Job JAF-2026-1001 is ready for pickup.",
									docId: "doc-1",
									createdAt: new Date("2026-07-24T10:00:00Z"),
								},
								{
									id: "2",
									message: "Job JAF-2026-1002 requires your signature.",
									docId: null,
									createdAt: new Date("2026-07-25T08:30:00Z"),
								},
							]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		expect(screen.getByText("2")).toBeInTheDocument()
	})

	it("opens the notification dropdown and lists unread notifications", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[
								{
									id: "1",
									message: "Job JAF-2026-1001 is ready for pickup.",
									docId: "doc-1",
									createdAt: new Date("2026-07-24T10:00:00Z"),
								},
							]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		await userEvent.click(screen.getByRole("button", { name: "Notifications" }))
		expect(
			screen.getByText("Job JAF-2026-1001 is ready for pickup."),
		).toBeInTheDocument()
	})

	it("shows an empty state when there are no unread notifications", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		await userEvent.click(screen.getByRole("button", { name: "Notifications" }))
		expect(screen.getByText("No new notifications")).toBeInTheDocument()
	})

	it("hides mark-all-read when there are no unread notifications", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		await userEvent.click(screen.getByRole("button", { name: "Notifications" }))
		expect(
			screen.queryByRole("button", { name: "Mark all as read" }),
		).not.toBeInTheDocument()
	})

	it("shows mark-all-read when there are unread notifications", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[
								{
									id: "1",
									message: "Job JAF-2026-1001 is ready for pickup.",
									docId: "doc-1",
									createdAt: new Date("2026-07-24T10:00:00Z"),
								},
							]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		await userEvent.click(screen.getByRole("button", { name: "Notifications" }))
		const markAllButton = screen.getByRole("button", {
			name: "Mark all as read",
		})
		expect(markAllButton).toBeInTheDocument()
		expect(markAllButton.closest("form")).toHaveAttribute(
			"action",
			"/notifications/mark-all-read",
		)
		expect(
			markAllButton.closest("form")?.querySelector('input[name="redirectTo"]'),
		).toHaveValue("/")
	})

	it("submits a POST to the per-notification read route with a redirect target", async ({
		renderStub,
	}) => {
		await renderStub({
			props: { initialEntries: ["/dashboard"] },
			entries: [
				{
					path: "/dashboard",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[
								{
									id: "1",
									message: "Job JAF-2026-1001 is ready for pickup.",
									docId: "doc-1",
									createdAt: new Date("2026-07-24T10:00:00Z"),
								},
							]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		await userEvent.click(screen.getByRole("button", { name: "Notifications" }))
		const row = screen.getByRole("button", {
			name: "Job JAF-2026-1001 is ready for pickup.",
		})
		expect(row.closest("form")).toHaveAttribute(
			"action",
			"/notifications/1/read",
		)
		expect(
			row.closest("form")?.querySelector('input[name="redirectTo"]'),
		).toHaveValue("/dashboard")
	})

	it("closes the notification dropdown when a notification row is clicked", async ({
		renderStub,
	}) => {
		await renderStub({
			props: { initialEntries: ["/dashboard"] },
			entries: [
				{
					path: "/dashboard",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[
								{
									id: "1",
									message: "Job JAF-2026-1001 is ready for pickup.",
									docId: "doc-1",
									createdAt: new Date("2026-07-24T10:00:00Z"),
								},
							]}
						>
							<p>content</p>
						</AppShell>
					),
				},
				{
					path: "/notifications/1/read",
					action: async () => new Response(null, { status: 200 }),
					Component: () => null,
				},
			],
		})
		await userEvent.click(screen.getByRole("button", { name: "Notifications" }))
		const row = screen.getByRole("button", {
			name: "Job JAF-2026-1001 is ready for pickup.",
		})
		await userEvent.click(row)
		await waitFor(() => {
			expect(
				screen.queryByText("Job JAF-2026-1001 is ready for pickup."),
			).not.toBeInTheDocument()
		})
	})

	it("shows a hamburger trigger and no drawer content by default", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		expect(
			screen.getByRole("button", { name: "Open navigation menu" }),
		).toBeInTheDocument()
		expect(
			screen.queryByRole("dialog", { name: "Navigation" }),
		).not.toBeInTheDocument()
	})

	it("opens the drawer with role-scoped nav links when the hamburger is clicked", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		await userEvent.click(
			screen.getByRole("button", { name: "Open navigation menu" }),
		)
		const drawer = screen.getByRole("dialog", { name: "Navigation" })
		expect(
			within(drawer).getByRole("link", { name: "Dashboard" }),
		).toBeInTheDocument()
		expect(
			within(drawer).getByRole("link", { name: "+ New Document" }),
		).toBeInTheDocument()
		expect(
			within(drawer).queryByRole("link", { name: "Admin Settings" }),
		).not.toBeInTheDocument()
	})

	it("closes the drawer when a nav link inside it is clicked", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[]}
						>
							<Outlet />
						</AppShell>
					),
					children: [
						{ index: true, Component: () => <p>content</p> },
						{ path: "dashboard", Component: () => <p>dashboard page</p> },
					],
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
		// The popup unmounts only after its CSS exit animation finishes
		// (base-ui's data-closed animate-out), so give the assertion a beat
		// instead of asserting the very next microtask.
		await waitFor(() => {
			expect(
				screen.queryByRole("dialog", { name: "Navigation" }),
			).not.toBeInTheDocument()
		})
	})

	it("closes the drawer when the backdrop is clicked", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AppShell
							user={{ name: "Jose Alfaro", role: "SUPERVISOR" }}
							notifications={[]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		await userEvent.click(
			screen.getByRole("button", { name: "Open navigation menu" }),
		)
		expect(
			screen.getByRole("dialog", { name: "Navigation" }),
		).toBeInTheDocument()
		// Click a point on the backdrop outside the drawer's bounding box. The
		// backdrop spans the full viewport, and in this browser test's narrow
		// viewport a default (center-of-element) click lands underneath the
		// 288px-wide drawer, so Playwright reports the drawer as intercepting
		// the click. Real users click the visible sliver beside the drawer;
		// this asserts that same interaction.
		// UserEventClickOptions is typed as an empty interface in
		// @vitest/browser/context.d.ts, but Playwright's locator.click() does
		// support `position` at runtime.
		await userEvent.click(screen.getByTestId("nav-drawer-backdrop"), {
			position: { x: 320, y: 20 },
		} as Parameters<typeof userEvent.click>[1])
		// The popup unmounts only after its CSS exit animation finishes
		// (base-ui's data-closed animate-out), so give the assertion a beat
		// instead of asserting the very next microtask.
		await waitFor(() => {
			expect(
				screen.queryByRole("dialog", { name: "Navigation" }),
			).not.toBeInTheDocument()
		})
	})
})
