import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { FinanceHome } from "~/lib/finance-home"
import { FinanceHomeView } from "./finance-home"

const home: FinanceHome = {
	blockedCount: 0,
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

const mount = (renderStub: any, view: FinanceHome = home) =>
	renderStub({
		entries: [{ path: "/", Component: () => <FinanceHomeView home={view} /> }],
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

	it("flags a request past its pay day and says what is blocked", async ({
		renderStub,
	}) => {
		await mount(renderStub, {
			...home,
			blockedCount: 4,
			armA: home.armA.map((tile) =>
				tile.key === "waiting_carmen"
					? { ...tile, count: 1, oldestDays: 11, overdue: 1 }
					: tile,
			),
			nextUp: [
				{
					id: "r1",
					controlNumber: "10/12/2026 – 10/25/2026",
					avisoNumber: null,
					step: "LISTS",
					waitingDays: 11,
					href: "/finance/payroll?tab=waiting",
					note: "overdue",
				},
				{
					id: "j2",
					controlNumber: "MAINT261023001",
					avisoNumber: "10358032",
					step: "LISTS",
					waitingDays: 0,
					href: "/finance/payroll",
					note: "blocked",
				},
			],
		})
		const carmen = screen.getByRole("link", { name: /Waiting on Carmen/ })
		expect(carmen).toHaveAttribute("data-tone", "flag")
		expect(carmen).toHaveTextContent("past pay day")
		expect(
			screen.getByText(/Blocked: brigade not linked, 4 sold/),
		).toBeInTheDocument()
		const blocked = screen.getByRole("link", { name: /MAINT261023001/ })
		expect(blocked).toHaveTextContent("Blocked: brigade not linked")
		expect(
			screen.getByRole("link", { name: /10\/12\/2026/ }),
		).toHaveTextContent("Past pay day")
	})
})
