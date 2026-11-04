import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import {
	CrewPicker,
	type CrewPickerBrigade,
	matchesBrigadeQuery,
} from "./crew-picker"

function row(
	id: string,
	name: string,
	code: string,
	extra: Partial<CrewPickerBrigade> = {},
): CrewPickerBrigade {
	return {
		id,
		name,
		area: "CENTRAL",
		code,
		leadName: null,
		state: "own",
		active: true,
		supervisorName: null,
		lastWorkedAt: null,
		...extra,
	}
}

const brigades = [
	row("b1", "ALEXIS DIAZ", "206"),
	row("b2", "DINO CASTILLO", "029"),
	row("b3", "ZARIEL SIERRA", "274"),
	row("b4", "ANGEL BLAZQUEZ", "045", { state: "inactive", active: false }),
	row("b5", "ÁNGEL RUIZ", "040"),
	row("b6", "JESUS MARTINEZ", "009", {
		state: "with_other",
		supervisorName: "Edgard Ocasio",
		lastWorkedAt: "2026-10-28T15:00:00.000Z",
	}),
	row("b7", "JESUS RIVERA", "118", {
		state: "with_other",
		active: false,
		supervisorName: "Edgard Ocasio",
	}),
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
				Component: () => (
					<CrewPicker
						brigades={brigades}
						initialSelected={props.initialSelected}
					/>
				),
			},
		],
	})

const search = (q: string) =>
	userEvent.type(screen.getByRole("searchbox", { name: "Search brigades" }), q)

describe("CrewPicker", () => {
	it("has one mode: no switch, select-all or share button, and the hint until a crew is picked", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		expect(screen.getByText("Tap a chip, or search any brigade.")).toBeTruthy()
		for (const name of [
			"Select all crews",
			"Back to one crew",
			"+ Add another crew",
		])
			expect(screen.queryByRole("button", { name })).toBeNull()
		expect(
			screen.getByRole("searchbox", { name: "Search brigades" }),
		).toBeTruthy()
	})

	it("lists only the viewer's own brigades as chips", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		for (const n of ["ALEXIS DIAZ", "DINO CASTILLO", "ZARIEL SIERRA"])
			expect(screen.getByText(n)).toBeTruthy()
		expect(screen.queryByText("JESUS MARTINEZ")).toBeNull()
		expect(screen.queryByText("ANGEL BLAZQUEZ")).toBeNull()
	})

	it("a chip adds a crew and the count follows; the first picked is the lead", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		await userEvent.click(screen.getByText("DINO CASTILLO"))
		expect(screen.getByText("Assigned crew · 1 crew")).toBeTruthy()
		expect(screen.queryByText("Lead")).toBeNull()
		await userEvent.click(screen.getByText("ALEXIS DIAZ"))
		expect(submitted()).toEqual(["b2", "b1"])
		expect(screen.getByText("Assigned crew · 2 crews")).toBeTruthy()
		expect(screen.getAllByText("Lead")).toHaveLength(1)
	})

	it("× removes a crew, and the chip comes back", async ({ renderStub }) => {
		await mount(renderStub, { initialSelected: ["b1", "b2"] })
		await userEvent.click(
			screen.getByRole("button", { name: "Remove ALEXIS DIAZ" }),
		)
		expect(submitted()).toEqual(["b2"])
		expect(screen.getByText("ALEXIS DIAZ")).toBeTruthy()
	})

	it("shows the payment note only once two or more crews are selected, naming the lead", async ({
		renderStub,
	}) => {
		await mount(renderStub)
		await userEvent.click(screen.getByText("DINO CASTILLO"))
		expect(screen.queryByTestId("lead-payment-note")).toBeNull()
		await userEvent.click(screen.getByText("ALEXIS DIAZ"))
		expect(screen.getByTestId("lead-payment-note").textContent).toContain(
			"DINO CASTILLO",
		)
	})

	it("changes the lead without re-picking", async ({ renderStub }) => {
		await mount(renderStub, { initialSelected: ["b1", "b2"] })
		await userEvent.click(screen.getByRole("button", { name: "Make lead" }))
		expect(submitted()).toEqual(["b2", "b1"])
	})

	it("reloads a saved crew in order", async ({ renderStub }) => {
		await mount(renderStub, { initialSelected: ["b2", "b1"] })
		expect(submitted()).toEqual(["b2", "b1"])
		expect(screen.getByText("Assigned crew · 2 crews")).toBeTruthy()
	})

	describe("search", () => {
		it("reaches another supervisor's brigade: Active, usually with, last worked, one tap to add", async ({
			renderStub,
		}) => {
			await mount(renderStub)
			await search("jes")
			expect(screen.getByText("Active")).toBeTruthy()
			expect(
				screen.getByText(/usually with Edgard Ocasio · last worked Oct 28/),
			).toBeTruthy()
			await userEvent.click(screen.getByRole("button", { name: "Add" }))
			expect(submitted()).toEqual(["b6"])
			// The search clears and the crew shows who it usually works with.
			expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("")
			expect(screen.getByText("usually with Edgard Ocasio")).toBeTruthy()
		})

		it("shows an inactive brigade as Inactive with Activate and add, no confirmation step", async ({
			renderStub,
		}) => {
			await mount(renderStub)
			await search("blaz")
			expect(screen.getByText("Inactive")).toBeTruthy()
			await userEvent.click(
				screen.getByRole("button", { name: "Activate and add" }),
			)
			expect(submitted()).toEqual(["b4"])
			expect(screen.queryByRole("alertdialog")).toBeNull()
		})

		it("lets another supervisor's inactive brigade be activated and added too", async ({
			renderStub,
		}) => {
			await mount(renderStub)
			await search("rivera")
			await userEvent.click(
				screen.getByRole("button", { name: "Activate and add" }),
			)
			expect(submitted()).toEqual(["b7"])
		})

		it('"angel" matches ÁNGEL accent-insensitively', async ({ renderStub }) => {
			await mount(renderStub)
			await search("angel")
			// ÁNGEL RUIZ is also one of the viewer's own chips.
			expect(screen.getAllByText("ÁNGEL RUIZ")).toHaveLength(2)
			expect(screen.getByText("ANGEL BLAZQUEZ")).toBeTruthy()
		})

		it('"04" lists 045 and 040 by code prefix', async ({ renderStub }) => {
			await mount(renderStub)
			await search("04")
			expect(screen.getByText("ANGEL BLAZQUEZ")).toBeTruthy()
			expect(screen.getAllByText("ÁNGEL RUIZ")).toHaveLength(2)
			expect(screen.queryByText("JESUS MARTINEZ")).toBeNull()
		})

		it("never offers a brigade already on the crew, and keeps the crew while searching", async ({
			renderStub,
		}) => {
			await mount(renderStub, { initialSelected: ["b5"] })
			await search("angel")
			expect(screen.getAllByText("ÁNGEL RUIZ")).toHaveLength(1)
			expect(submitted()).toEqual(["b5"])
		})

		it("says so when nothing matches", async ({ renderStub }) => {
			await mount(renderStub)
			await search("zzzz")
			expect(screen.getByText("No brigade matches that search.")).toBeTruthy()
		})
	})
})

describe("matchesBrigadeQuery", () => {
	const b = { name: "ÁNGEL RUIZ", code: "040" }
	it("matches name substrings ignoring case and accents", () => {
		expect(matchesBrigadeQuery(b, "angel")).toBe(true)
		expect(matchesBrigadeQuery(b, "gel r")).toBe(true)
		expect(matchesBrigadeQuery(b, "zzz")).toBe(false)
	})
	it("matches code by prefix only", () => {
		expect(matchesBrigadeQuery(b, "04")).toBe(true)
		expect(matchesBrigadeQuery(b, "40")).toBe(false)
		expect(matchesBrigadeQuery({ name: "X", code: null }, "04")).toBe(false)
	})
})
