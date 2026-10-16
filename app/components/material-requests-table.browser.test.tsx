import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { MaterialRequestsTable } from "./material-requests-table"

const base = {
	page: 1,
	pageCount: 1,
	total: 2,
	pageSize: 20,
	hrefFor: (p: number) => `?page=${p}`,
}

const request = (id: string, status: string) => ({
	id,
	vanName: "Van 3",
	status,
	submittedAt: "2026-09-20T12:00:00Z",
	materialCount: 5,
	unitCount: 14,
})

describe("MaterialRequestsTable", () => {
	it("offers Release only on a request that is still pending", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<MaterialRequestsTable
							{...base}
							requests={[
								request("abc000111", "SUBMITTED"),
								request("abc000222", "RELEASED"),
							]}
						/>
					),
				},
			],
		})
		const pending = screen.getByTestId("request-row-abc000111")
		expect(pending).toHaveTextContent("5 materials · 14 units")
		expect(pending.querySelector("a")).toHaveAttribute(
			"href",
			"/restock/abc000111/release",
		)
		expect(
			screen.getByTestId("request-row-abc000222").querySelector("a"),
		).toBeNull()
	})

	it("shows an empty state", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<MaterialRequestsTable {...base} total={0} requests={[]} />
					),
				},
			],
		})
		expect(screen.getByText("No material requests yet.")).toBeInTheDocument()
	})
})
