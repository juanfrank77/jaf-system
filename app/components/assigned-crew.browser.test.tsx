import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AssignedCrew } from "./assigned-crew"

const b = (id: string, name: string, lead = false) => ({
	id,
	name,
	code: id === "b1" ? "206" : null,
	lead,
})

// Same loose typing the other component tests use for the stub fixture.
const mount = (renderStub: any, props: Parameters<typeof AssignedCrew>[0]) =>
	renderStub({
		entries: [{ path: "/", Component: () => <AssignedCrew {...props} /> }],
	})

describe("AssignedCrew", () => {
	it("renders nothing when no brigade or member is assigned (no empty Crew line)", async ({
		renderStub,
	}) => {
		await mount(renderStub, { brigades: [], memberNames: [] })
		expect(screen.queryByText("Crew:")).toBeNull()
	})

	it("shows one Crew row for a shared job: brigades, lead badge and the payment note", async ({
		renderStub,
	}) => {
		await mount(renderStub, {
			brigades: [b("b2", "JESUS MARTINEZ", true), b("b1", "ALEXIS DIAZ")],
			memberNames: [],
		})
		expect(screen.getAllByText("Crew:")).toHaveLength(1)
		expect(screen.queryByText("Brigades:")).toBeNull()
		expect(screen.getByText("Lead").closest("p")).toHaveTextContent(
			"JESUS MARTINEZ",
		)
		expect(screen.getByTestId("lead-payment-note")).toBeInTheDocument()
	})

	it("a single brigade has no lead badge or note, and members trail in muted text", async ({
		renderStub,
	}) => {
		await mount(renderStub, {
			brigades: [b("b1", "ALEXIS DIAZ", true)],
			memberNames: ["Ana", "Luis"],
		})
		expect(screen.queryByText("Lead")).toBeNull()
		expect(screen.queryByTestId("lead-payment-note")).toBeNull()
		expect(screen.getByText(/Ana, Luis/)).toBeInTheDocument()
	})

	it("falls back to member names for an older job with no brigade", async ({
		renderStub,
	}) => {
		await mount(renderStub, { brigades: [], memberNames: ["Ana"] })
		expect(screen.getByText("Crew:")).toBeInTheDocument()
		expect(screen.getByText("Ana")).toBeInTheDocument()
	})
})
