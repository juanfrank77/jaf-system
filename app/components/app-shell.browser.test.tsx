import { screen, within } from "@testing-library/react"
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
})
