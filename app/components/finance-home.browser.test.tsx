import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { FinanceHome } from "~/lib/finance-home"
import { FinanceHomeView } from "./finance-home"

const home: FinanceHome = {
	armA: [
		{ key: "inbox", count: 3, href: "/finance/queue", oldestDays: 1 },
		{
			key: "pbcc_batch",
			count: 47,
			href: "/finance/lc-requests",
			amount: 18442.1,
		},
		{
			key: "waiting_carmen",
			count: 0,
			href: "/finance/payroll",
			oldestDays: null,
		},
	],
	armB: [
		{ key: "pos_to_confirm", count: null, href: null },
		{ key: "invoices_to_load", count: null, href: null },
		{ key: "claro_past_due", count: null, href: null },
	],
	nextUp: [
		{
			id: "j1",
			controlNumber: "MAINT261022001",
			avisoNumber: "10356247",
			step: "PACKETS",
			waitingDays: 4,
			href: "/finance/verify/j1",
		},
	],
}

const mount = (renderStub: any) =>
	renderStub({
		entries: [{ path: "/", Component: () => <FinanceHomeView home={home} /> }],
	})

describe("FinanceHomeView", () => {
	it("makes each live box a link to its section, with the oldest age", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		const inbox = screen.getByRole("link", { name: /Inbox to review/ })
		expect(inbox).toHaveAttribute("href", "/finance/queue")
		expect(within(inbox).getByText("oldest 1 day")).toBeInTheDocument()
	})

	it("shows the batch as rows / 100 with its total", async ({ renderStub }) => {
		await mount(renderStub)
		const batch = screen.getByRole("link", { name: /Open PBCC batch/ })
		expect(within(batch).getByText("47 / 100")).toBeInTheDocument()
		expect(within(batch).getByText("$18442.10")).toBeInTheDocument()
	})

	it("keeps an empty box in place as all clear", async ({ renderStub }) => {
		await mount(renderStub)
		const carmen = screen.getByRole("link", { name: /Waiting on Carmen/ })
		expect(within(carmen).getByText("All clear")).toBeInTheDocument()
	})

	it("shows Arm B boxes as not live, without a link", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		expect(
			screen.queryByRole("link", { name: /POs to confirm/ }),
		).not.toBeInTheDocument()
		expect(screen.getAllByText("Not live yet")).toHaveLength(3)
	})

	it("lists the next item and opens it", async ({ renderStub }) => {
		await mount(renderStub)
		const row = screen.getByRole("link", { name: /MAINT261022001/ })
		expect(row).toHaveAttribute("href", "/finance/verify/j1")
		expect(row).toHaveTextContent("Inbox · 4 days")
	})
})
