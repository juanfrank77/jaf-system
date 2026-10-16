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

	it.for(["review", "job"] as const)(
		"links Approve onward to that step's review screen from the %s page",
		async (page, { renderStub }) => {
			await mount(
				renderStub,
				<SupervisorStepRail
					stage="PRECERT"
					view="PRECERT"
					docId="d1"
					page={page}
				/>,
			)
			expect(screen.getByRole("link", { name: "4. Approve" })).toHaveAttribute(
				"href",
				"/docs/d1/review?step=APPROVE",
			)
			expect(
				screen.getByRole("link", { name: "6. Aviso & match" }),
			).toHaveAttribute("href", "/docs/d1/review?step=AVISO")
		},
	)

	it("sends Intake, Warehouse and Field back to the job page, except on the job page itself", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<SupervisorStepRail stage="PRECERT" view="PRECERT" docId="d1" />,
		)
		for (const name of ["1. Intake", "2. Warehouse", "3. Field"]) {
			expect(screen.getByRole("link", { name })).toHaveAttribute(
				"href",
				"/docs/d1",
			)
		}
	})

	it("leaves the early steps unlinked on the job page", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<SupervisorStepRail stage="PRECERT" docId="d1" page="job" />,
		)
		expect(
			screen.queryByRole("link", { name: "1. Intake" }),
		).not.toBeInTheDocument()
	})

	it("does not link the current step or unreached steps", async ({
		renderStub,
	}) => {
		await mount(
			renderStub,
			<SupervisorStepRail stage="PRECERT" view="PRECERT" docId="d1" />,
		)
		for (const name of ["7. Pre-cert sheet", "8. Release"]) {
			expect(screen.queryByRole("link", { name })).not.toBeInTheDocument()
		}
	})

	it("links nothing without a doc (the new work order screen)", async ({
		renderStub,
	}) => {
		await mount(renderStub, <SupervisorStepRail stage="INTAKE" />)
		expect(screen.queryAllByRole("link")).toHaveLength(0)
	})
})
