import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { CrewPicker } from "./crew-picker"

const brigades = [
	{
		id: "b1",
		name: "ALEXIS DIAZ",
		area: "CENTRAL",
		code: "206",
		leadName: null,
	},
	{
		id: "b2",
		name: "DINO CASTILLO",
		area: "CENTRAL",
		code: "209",
		leadName: null,
	},
	{
		id: "b3",
		name: "ZARIEL SIERRA",
		area: "CENTRAL",
		code: "274",
		leadName: null,
	},
]

function submitted() {
	return Array.from(
		document.querySelectorAll<HTMLInputElement>('input[name="brigadeId"]'),
	).map((i) => i.value)
}

// Same loose typing the other component tests use for the stub fixture.
const mount = (renderStub: any, props: { initialSelected?: string[] } = {}) =>
	renderStub({
		entries: [
			{
				path: "/",
				Component: () => <CrewPicker brigades={brigades} {...props} />,
			},
		],
	})

const share = () =>
	userEvent.click(
		screen.getByRole("button", { name: "+ Share with another crew" }),
	)

describe("CrewPicker", () => {
	it("defaults to a single crew: picking another replaces the first, with no sharing controls or note", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		expect(
			screen.queryByRole("button", { name: "Select all crews" }),
		).toBeNull()
		await userEvent.click(screen.getByText("ALEXIS DIAZ"))
		await userEvent.click(screen.getByText("DINO CASTILLO"))
		expect(submitted()).toEqual(["b2"])
		expect(screen.queryByTestId("lead-payment-note")).toBeNull()
	})

	it("sharing is deliberate: it keeps the current crew and lets more be added, first picked is the lead", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		await userEvent.click(screen.getByText("DINO CASTILLO"))
		await share()
		await userEvent.click(screen.getByText("ALEXIS DIAZ"))
		expect(submitted()).toEqual(["b2", "b1"])
		expect(screen.getAllByText("Lead")).toHaveLength(1)
	})

	it("shows the payment note only once two or more crews are selected, naming the lead", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		await userEvent.click(screen.getByText("ALEXIS DIAZ"))
		await share()
		expect(screen.queryByTestId("lead-payment-note")).toBeNull()
		await userEvent.click(screen.getByText("DINO CASTILLO"))
		const note = screen.getByTestId("lead-payment-note")
		expect(note).toHaveTextContent("Payment goes to the lead brigade only")
		expect(note).toHaveTextContent("ALEXIS DIAZ is the lead")
		expect(note).toHaveTextContent("Finance splits shared jobs manually")
		expect(note).not.toHaveTextContent("Carmen")
		await userEvent.click(screen.getByText("DINO CASTILLO"))
		expect(screen.queryByTestId("lead-payment-note")).toBeNull()
	})

	it("offers select-all only while sharing", async ({ renderStub }) => {
		await mount(renderStub)
		await share()
		await userEvent.click(
			screen.getByRole("button", { name: "Select all crews" }),
		)
		expect(submitted()).toEqual(["b1", "b2", "b3"])
	})

	it("going back to one crew keeps only the lead", async ({ renderStub }) => {
		await mount(renderStub, { initialSelected: ["b3", "b1"] })
		await userEvent.click(
			screen.getByRole("button", { name: "Back to one crew" }),
		)
		expect(submitted()).toEqual(["b3"])
		expect(screen.queryByTestId("lead-payment-note")).toBeNull()
	})

	it("opens in sharing mode for a job that is already shared, and changes the lead without re-picking", async ({
		renderStub,
	}) => {
		await mount(renderStub, { initialSelected: ["b1", "b2", "b3"] })
		const makeLead = screen.getAllByRole("button", { name: "Make lead" })
		expect(makeLead).toHaveLength(2)
		await userEvent.click(makeLead[1]) // b3
		expect(submitted()).toEqual(["b3", "b1", "b2"])
		expect(screen.getByTestId("lead-payment-note")).toHaveTextContent(
			"ZARIEL SIERRA is the lead",
		)
	})

	it("starts a single saved crew in single mode", async ({ renderStub }) => {
		await mount(renderStub, { initialSelected: ["b2"] })
		expect(submitted()).toEqual(["b2"])
		expect(
			screen.getByRole("button", { name: "+ Share with another crew" }),
		).toBeInTheDocument()
	})

	it("reloads a shared job with every crew ticked, the saved lead badged first, and the payment note", async ({
		renderStub,
	}) => {
		await mount(renderStub, { initialSelected: ["b3", "b1"] })
		const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[]
		expect(boxes.map((b) => b.checked)).toEqual([true, false, true])
		const lead = screen.getByText("Lead")
		expect(lead.closest("label")).toHaveTextContent("ZARIEL SIERRA")
		expect(screen.getByTestId("lead-payment-note")).toHaveTextContent(
			"ZARIEL SIERRA is the lead",
		)
		expect(submitted()).toEqual(["b3", "b1"])
	})
})
