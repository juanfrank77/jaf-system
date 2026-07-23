import { screen, waitFor, within } from "@testing-library/react"
import { userEvent } from "@vitest/browser/context"
import { describe, expect, it } from "vitest"
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
			screen.getByRole("link", { name: "Receivables", hidden: true }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("link", { name: "Admin Settings", hidden: true }),
		).toBeInTheDocument()
		expect(
			screen.getByRole("link", { name: "Catalog", hidden: true }),
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
							notifications={[{ id: "1" }, { id: "2" }]}
						>
							<p>content</p>
						</AppShell>
					),
				},
			],
		})
		expect(screen.getByText("2")).toBeInTheDocument()
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
							<p>content</p>
						</AppShell>
					),
				},
				{ path: "/dashboard", Component: () => <p>dashboard page</p> },
			],
		})
		await userEvent.click(
			screen.getByRole("button", { name: "Open navigation menu" }),
		)
		const drawer = screen.getByRole("dialog", { name: "Navigation" })
		await userEvent.click(
			within(drawer).getByRole("link", { name: "Dashboard" }),
		)
		expect(
			screen.queryByRole("dialog", { name: "Navigation" }),
		).not.toBeInTheDocument()
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
