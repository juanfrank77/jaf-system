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
	it("shows the service items and the four material columns together", async ({
		renderStub,
	}) => {
		await mount(renderStub, <JobLinesCard {...props} />)
		const card = screen.getByTestId("job-lines")
		expect(within(card).getByText("34006301")).toBeInTheDocument()
		for (const key of ["estimated", "prepped", "taken", "used"]) {
			expect(screen.getByTestId(`job-lines-${key}`)).toBeInTheDocument()
		}
		expect(screen.getByTestId("job-lines-used")).toHaveTextContent("CLAMP")
		expect(screen.getByTestId("job-lines-prepped")).toHaveTextContent(
			"WRAP NET",
		)
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
		expect(screen.getByTestId("job-lines-taken")).toHaveTextContent("—")
	})

	it("can show only the service items", async ({ renderStub }) => {
		await mount(renderStub, <JobLinesCard {...props} showMaterials={false} />)
		expect(screen.getByText("Service items")).toBeInTheDocument()
		expect(screen.queryByTestId("job-lines-used")).toBeNull()
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
