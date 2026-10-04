import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RoleDashboard } from "./role-dashboard"

const base = { stats: [], alert: null, explainer: null, docs: [] }
const emptyQueues = {
	pendingReview: [],
	sentBack: [],
	missingAviso: [],
	blocked: [],
}

// Spread so biome's a11y rule does not mistake the `role` prop for an ARIA role.
const supervisor = {
	role: "SUPERVISOR" as const,
	supervisorQueues: emptyQueues,
}

const mount = (renderStub: any, ui: React.ReactElement) =>
	renderStub({ entries: [{ path: "/", Component: () => ui }] })

describe("RoleDashboard", () => {
	for (const role of [
		"CREW",
		"WAREHOUSE",
		"FINANCE",
		"ADMIN",
		"INSTALLER",
		"INSTALLER_SUPERVISOR",
		"COMPTROLLER",
	] as const) {
		it(`renders the dashboard for ${role}`, async ({ renderStub }) => {
			await mount(
				renderStub,
				<RoleDashboard role={role} supervisorQueues={null} {...base} />,
			)
			expect(
				screen.getByRole("heading", { level: 1, name: "Dashboard" }),
			).toBeInTheDocument()
		})
	}

	it("renders the four supervisor queues for SUPERVISOR", async ({
		renderStub,
	}) => {
		await mount(renderStub, <RoleDashboard {...supervisor} {...base} />)
		expect(
			screen.getByRole("heading", { level: 1, name: "Dashboard" }),
		).toBeInTheDocument()
		expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(4)
	})
})
