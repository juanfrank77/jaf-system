import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ConnectionBar, ConnectionDot } from "./offline-indicator"

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

describe("ConnectionBar", () => {
	it("says everything is synced when online with nothing queued", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<ConnectionBar state={{ online: true, pendingCount: 0 }} />,
		)
		expect(screen.getByRole("status")).toHaveTextContent(
			"Online — everything synced",
		)
	})

	it("shows the queued count while online", async ({ renderStub }) => {
		await mount(
			renderStub,
			<ConnectionBar state={{ online: true, pendingCount: 3 }} />,
		)
		expect(screen.getByRole("status")).toHaveTextContent(
			"3 changes pending sync",
		)
	})

	it("says offline, and counts queued updates when there are some", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<ConnectionBar state={{ online: false, pendingCount: 0 }} />,
		)
		expect(screen.getByRole("status")).toHaveTextContent(
			"Offline — changes will sync when you reconnect",
		)
	})

	it("shows the count when offline with queued updates", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<ConnectionBar state={{ online: false, pendingCount: 2 }} />,
		)
		expect(screen.getByRole("status")).toHaveTextContent(
			"Offline — 2 changes waiting to sync",
		)
	})
})

describe("ConnectionDot", () => {
	it("is a hidden dot carrying the state", async ({ renderStub }) => {
		await mount(
			renderStub,
			<ConnectionDot state={{ online: false, pendingCount: 0 }} />,
		)
		const dot = document.querySelector('[data-slot="connection-dot"]')
		expect(dot).toHaveAttribute("aria-hidden", "true")
		expect(dot).toHaveAttribute("data-state", "offline")
	})

	it("is pending when online with queued updates, synced otherwise", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<div>
				<ConnectionDot state={{ online: true, pendingCount: 1 }} />
				<ConnectionDot state={{ online: true, pendingCount: 0 }} />
			</div>,
		)
		const dots = document.querySelectorAll('[data-slot="connection-dot"]')
		expect(dots[0]).toHaveAttribute("data-state", "pending")
		expect(dots[1]).toHaveAttribute("data-state", "synced")
	})
})
