import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { JobLinesCard, preppedAsLines } from "./job-lines-card"

const serviceCodes = [
	{ id: "m1", claroCode: "1020002", name: "WRAP NET", unit: "EA" },
	{ id: "m2", claroCode: "1020003", name: "CLAMP", unit: "EA" },
] as never

const ordered = [
	{
		serviceCodeId: "s1",
		claroCode: "34006301",
		accountCode: "610",
		name: "TRANSFER ATTCH",
		qty: 2,
	},
]

const props = {
	ordered,
	installed: [{ ...ordered[0], qty: 1 }],
	estimated: [{ serviceCodeId: "m1", qty: 6 }],
	prepped: [{ serviceCodeId: "m1", qty: 5 }],
	taken: [{ serviceCodeId: "m1", qty: 5 }],
	used: [{ serviceCodeId: "m2", qty: 3 }],
	serviceCodes,
}

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

describe("JobLinesCard", () => {
	it("shows the service items and the materials as a table with one column per stage", async ({
		renderStub,
	}) => {
		await mount(renderStub, <JobLinesCard {...props} />)
		const card = screen.getByTestId("job-lines")
		expect(within(card).getByText("34006301")).toBeInTheDocument()
		const table = screen.getByTestId("job-lines-materials")
		for (const col of [
			"Estimated",
			"Prepped",
			"Taken (signed)",
			"Used (field)",
		]) {
			expect(within(table).getByText(col)).toBeInTheDocument()
		}
		const wrap = within(table)
			.getByText("WRAP NET")
			.closest("tr") as HTMLElement
		expect(wrap).toHaveTextContent("6 EA")
		expect(wrap).toHaveTextContent("5 EA")
		const clamp = within(table).getByText("CLAMP").closest("tr") as HTMLElement
		expect(clamp).toHaveTextContent("3 EA")
		expect(clamp).toHaveTextContent("—")
	})

	it("renders no Difference column, even when installed differs from ordered", async ({
		renderStub,
	}) => {
		await mount(renderStub, <JobLinesCard {...props} />)
		const card = screen.getByTestId("job-lines")
		expect(within(card).queryByText("Difference")).not.toBeInTheDocument()
		expect(within(card).getByText("Installed")).toBeInTheDocument()
	})

	it("shows no money anywhere", async ({ renderStub }) => {
		await mount(renderStub, <JobLinesCard {...props} />)
		expect(screen.getByTestId("job-lines").textContent).not.toContain("$")
	})

	it("says so when a column is empty and when there are no service items", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<JobLinesCard
				{...props}
				ordered={[]}
				installed={[]}
				taken={[]}
				used={[]}
			/>,
		)
		expect(
			screen.getByText("No service items on this work order."),
		).toBeInTheDocument()
		expect(screen.getByTestId("job-lines-materials")).toBeInTheDocument()
	})

	const retensar = {
		serviceCodeId: "s9",
		claroCode: "34006300",
		accountCode: "610",
		name: "RETENSAR MENSAJERO MO",
		qty: 1,
		addedInField: true as const,
	}

	it("lists a service added in the field: Ordered 0, its installed qty, labelled", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<JobLinesCard
				{...props}
				installed={[{ ...ordered[0], qty: 2 }, retensar]}
			/>,
		)
		const row = screen.getByText("34006300").closest("tr") as HTMLElement
		const cells = within(row).getAllByRole("cell")
		expect(cells[1]).toHaveTextContent("RETENSAR MENSAJERO MO")
		expect(cells[1]).toHaveTextContent("Added in field")
		expect(cells[2]).toHaveTextContent(/^0$/)
		expect(cells[3]).toHaveTextContent(/^1$/)
		// The ordered row is not labelled.
		const transfer = screen.getByText("34006301").closest("tr") as HTMLElement
		expect(transfer).not.toHaveTextContent("Added in field")
	})

	it("shows a service added in the field even when nothing was ordered", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<JobLinesCard {...props} ordered={[]} installed={[retensar]} />,
		)
		expect(
			screen.queryByText("No service items on this work order."),
		).not.toBeInTheDocument()
		expect(screen.getByText("34006300")).toBeInTheDocument()
	})
})

describe("preppedAsLines", () => {
	it("reads preppedQty as qty and tolerates a bad column", () => {
		expect(preppedAsLines([{ serviceCodeId: "m1", preppedQty: 4 }])).toEqual([
			{ serviceCodeId: "m1", qty: 4 },
		])
		expect(preppedAsLines(null)).toEqual([])
	})
})
