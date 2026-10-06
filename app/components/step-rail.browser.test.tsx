import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { type RailStep, StepRail } from "./step-rail"

const steps: RailStep[] = [
	{ key: "a", label: "Created", href: "/x?step=a" },
	{ key: "b", label: "Prep" },
	{ key: "c", label: "Release", mine: true },
	{ key: "d", label: "Receive", locked: true, href: "/nope" },
]

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

describe("StepRail", () => {
	it("numbers every step and marks the current one", async ({ renderStub }) => {
		await mount(
			renderStub,
			<StepRail steps={steps} current={1} ariaLabel="Progress" />,
		)
		const list = screen.getByRole("list", { name: "Progress" })
		expect(within(list).getAllByRole("listitem")).toHaveLength(4)
		const current = screen.getByText("2. Prep").closest("li")
		expect(current).toHaveAttribute("aria-current", "step")
		expect(current).toHaveAttribute("data-state", "current")
		expect(screen.getByText("1. Created").closest("li")).toHaveAttribute(
			"data-state",
			"done",
		)
		expect(screen.getByText("3. Release").closest("li")).toHaveAttribute(
			"data-state",
			"todo",
		)
	})

	it("links a reached step that has an href", async ({ renderStub }) => {
		await mount(
			renderStub,
			<StepRail steps={steps} current={1} ariaLabel="Progress" />,
		)
		expect(screen.getByRole("link", { name: "1. Created" })).toHaveAttribute(
			"href",
			expect.stringMatching(/\/x\?step=a$/),
		)
	})

	it("never links the current step, even with an href", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<StepRail steps={steps} current={0} ariaLabel="Progress" />,
		)
		expect(
			screen.queryByRole("link", { name: "1. Created" }),
		).not.toBeInTheDocument()
	})

	it("renders a locked step greyed and never as a link", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<StepRail steps={steps} current={2} ariaLabel="Progress" />,
		)
		expect(screen.getByText("4. Receive").closest("li")).toHaveAttribute(
			"data-state",
			"locked",
		)
		expect(
			screen.queryByRole("link", { name: "4. Receive" }),
		).not.toBeInTheDocument()
	})

	it("has no current step when current is out of range", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<StepRail steps={steps} current={99} ariaLabel="Progress" />,
		)
		expect(document.querySelector("[aria-current]")).toBeNull()
	})

	it("renders an empty list for no steps", async ({ renderStub }) => {
		await mount(
			renderStub,
			<StepRail steps={[]} current={0} ariaLabel="Progress" />,
		)
		expect(screen.getByRole("list", { name: "Progress" })).toBeInTheDocument()
	})

	it("flags the compact layout", async ({ renderStub }) => {
		await mount(
			renderStub,
			<StepRail steps={steps} current={0} ariaLabel="Progress" compact />,
		)
		expect(screen.getByRole("list", { name: "Progress" })).toHaveAttribute(
			"data-compact",
			"true",
		)
	})
})
