import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { MovementTrail } from "./movement-trail"

describe("MovementTrail", () => {
	it("loads and renders the actor · time · job trail for the selected code", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<MovementTrail
							warehouseId="wh-1"
							serviceCodeId="sc-1"
							onClose={() => {}}
						/>
					),
				},
				{
					path: "/api/warehouse-stock-trail",
					loader: async () =>
						Response.json({
							trail: [
								{
									id: "m1",
									type: "RECEIVE",
									qty: 50,
									at: "2026-09-20T10:00:00Z",
									actor: "Orlando",
									note: "PO-9",
									job: null,
								},
							],
						}),
					Component: () => null,
				},
			],
		})
		await waitFor(() => {
			expect(screen.getByText("Orlando")).toBeInTheDocument()
		})
		expect(screen.getByText("RECEIVE")).toBeInTheDocument()
		expect(screen.getByText("PO-9")).toBeInTheDocument()
	})

	it("shows an empty state when there is no movement history yet", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<MovementTrail
							warehouseId="wh-1"
							serviceCodeId="sc-2"
							onClose={() => {}}
						/>
					),
				},
				{
					path: "/api/warehouse-stock-trail",
					loader: async () => Response.json({ trail: [] }),
					Component: () => null,
				},
			],
		})
		await waitFor(() => {
			expect(screen.getByText("No movements yet.")).toBeInTheDocument()
		})
	})
})
