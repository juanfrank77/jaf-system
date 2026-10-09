import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CrewDashboard } from "./crew-dashboard"

const doc = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	controlNumber: `JAF-${id}`,
	status: "SIGNED" as const,
	jobType: "Guy Wire",
	jobAddressEstimated: "PR-2 KM 88, Manatí",
	createdAt: new Date("2026-07-01"),
	...over,
})

describe("CrewDashboard", () => {
	it("is one flat list with plain status labels and no stat tiles", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<CrewDashboard
							stats={[{ labelKey: "dashboard.stat.open_documents", value: 9 }]}
							alert={null}
							explainer={null}
							docs={[doc("5", { status: "SUPERVISOR_APPROVED" })]}
							crewPreppedDocs={[doc("1", { status: "PREPPED" })]}
							crewInFieldDocs={[doc("2")]}
							crewSentBackDocs={[
								doc("3", {
									sendBackHistory: [{ note: "retake After photos" }],
								}),
							]}
							crewSubmittedDocs={[doc("4", { status: "FIELD_UPDATED" })]}
						/>
					),
				},
			],
		})
		expect(screen.getByText("4 open")).toBeInTheDocument()
		expect(screen.getByText("SENT BACK")).toBeInTheDocument()
		expect(screen.getByText("READY FOR PICKUP")).toBeInTheDocument()
		expect(screen.getByText("ON SITE")).toBeInTheDocument()
		expect(screen.getByText("SUBMITTED")).toBeInTheDocument()
		expect(screen.getByText("APPROVED")).toBeInTheDocument()
		expect(screen.getByText(/retake After photos/)).toBeInTheDocument()
		expect(screen.queryByText("Open documents")).not.toBeInTheDocument()
	})

	it("shows an empty state", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<CrewDashboard
							stats={[]}
							alert={null}
							explainer={null}
							docs={[]}
							crewPreppedDocs={[]}
							crewInFieldDocs={[]}
							crewSentBackDocs={[]}
							crewSubmittedDocs={[]}
						/>
					),
				},
			],
		})
		expect(
			screen.getByText("No jobs assigned to your brigade yet."),
		).toBeInTheDocument()
	})
})
