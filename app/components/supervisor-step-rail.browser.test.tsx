import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SupervisorStepRail } from "./supervisor-step-rail"

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

describe("SupervisorStepRail", () => {
	it("keeps the nine supervisor steps and their labels", async ({
		renderStub,
	}) => {
		await mount(renderStub, <SupervisorStepRail stage="PRECERT" />)
		expect(screen.getByText("1. Intake")).toBeInTheDocument()
		expect(screen.getByText("9. In Finance")).toBeInTheDocument()
		expect(screen.getByText("7. Pre-cert sheet").closest("li")).toHaveAttribute(
			"aria-current",
			"step",
		)
	})

	it("links reached supervisor steps (Approve onward) back to ?step=", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<SupervisorStepRail stage="PRECERT" view="PRECERT" />,
		)
		expect(screen.getByRole("link", { name: "4. Approve" })).toHaveAttribute(
			"href",
			expect.stringMatching(/\?step=APPROVE$/),
		)
		expect(
			screen.getByRole("link", { name: "6. Aviso & match" }),
		).toHaveAttribute("href", expect.stringMatching(/\?step=AVISO$/))
	})

	it("does not link steps before Approve, the current step, or unreached steps", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<SupervisorStepRail stage="PRECERT" view="PRECERT" />,
		)
		for (const name of [
			"1. Intake",
			"3. Field",
			"7. Pre-cert sheet",
			"8. Release",
		]) {
			expect(screen.queryByRole("link", { name })).not.toBeInTheDocument()
		}
	})
})
