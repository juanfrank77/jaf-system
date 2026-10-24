import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { PayrollRequestView } from "~/lib/payroll-request-view"
import { PayrollRequestCard } from "./payroll-request-card"

const request = (
	over: Partial<PayrollRequestView> = {},
): PayrollRequestView => ({
	id: "r1",
	label: "10/12/2026 – 10/25/2026",
	status: "waiting",
	sentAt: "2026-10-24T13:12:00Z",
	paidAt: null,
	ageDays: 2,
	pastPayDay: false,
	avisoCount: 3,
	lines: [
		{
			brigadeCode: "025",
			brigadeLabel: "Alexis Díaz",
			avisoNumbers: ["30077820"],
			net: 131.52,
			retention: 13.15,
			toPay: 118.37,
			accountId: "a1",
			paidAt: "2026-10-24T15:00:00Z",
			paidByName: "Carmen",
		},
		{
			brigadeCode: "009",
			brigadeLabel: "Jesús Martínez",
			avisoNumbers: ["10356113", "10356247"],
			net: 76.99,
			retention: 7.69,
			toPay: 69.3,
			accountId: "a2",
			paidAt: null,
			paidByName: null,
		},
	],
	...over,
})

const mount = (
	renderStub: any,
	props: Parameters<typeof PayrollRequestCard>[0],
) =>
	renderStub({
		entries: [
			{ path: "/", Component: () => <PayrollRequestCard {...props} /> },
		],
	})

describe("PayrollRequestCard", () => {
	it("shows a line per brigade with its Avisos, and who has paid", async ({
		renderStub,
	}) => {
		await mount(renderStub, { request: request() })
		const rows = await screen.findAllByRole("row")
		// header + two brigades + total
		expect(rows).toHaveLength(4)
		expect(within(rows[1]).getByText("Alexis Díaz")).toBeInTheDocument()
		expect(within(rows[1]).getByText("30077820")).toBeInTheDocument()
		expect(
			within(rows[1]).getByText("Paid 10/24/2026 by Carmen"),
		).toBeInTheDocument()
		expect(within(rows[2]).getByText("10356113 · 10356247")).toBeInTheDocument()
		expect(within(rows[2]).getByText("Waiting on Carmen")).toBeInTheDocument()
		expect(screen.getByText("1 of 2 brigades paid")).toBeInTheDocument()
	})

	it("totals net, retention and what to pay, and never shows a gross or JAF price column", async ({
		renderStub,
	}) => {
		await mount(renderStub, { request: request() })
		await screen.findAllByRole("row")
		const headers = screen
			.getAllByRole("columnheader")
			.map((h) => h.textContent?.trim())
		expect(headers).toEqual([
			"Brigade",
			"Avisos",
			"Net 65%",
			"10% ret.",
			"To pay",
			"Status",
		])
		expect(screen.queryByText(/gross/i)).toBeNull()
		expect(screen.getByText("$187.67")).toBeInTheDocument()
		expect(screen.getByText("Net is on pre-IVU labor.")).toBeInTheDocument()
	})

	it("marks a draft as not sent and offers the screen's own actions", async ({
		renderStub,
	}) => {
		await mount(renderStub, {
			request: request({ status: "draft", sentAt: null }),
			actions: <button type="button">Review and send</button>,
		})
		expect(await screen.findByText("Draft — not sent")).toBeInTheDocument()
		expect(
			screen.getByRole("button", { name: "Review and send" }),
		).toBeInTheDocument()
		expect(screen.queryByText(/sent to Carmen/)).toBeNull()
	})

	it("flags a waiting request past its pay day", async ({ renderStub }) => {
		await mount(renderStub, {
			request: request({ ageDays: 20, pastPayDay: true }),
		})
		expect(await screen.findByText("20d, overdue")).toBeInTheDocument()
	})

	it("shows the paid date on a finished request", async ({ renderStub }) => {
		await mount(renderStub, {
			request: request({
				status: "paid",
				paidAt: "2026-10-25T12:00:00Z",
			}),
		})
		expect(await screen.findByText("Paid 10/25/2026")).toBeInTheDocument()
	})
})
