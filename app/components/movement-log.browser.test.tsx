import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { MovementLog } from "./movement-log"

const base = {
	page: 1,
	pageCount: 1,
	total: 1,
	pageSize: 20,
	hrefFor: (p: number) => `?page=${p}`,
}

describe("MovementLog", () => {
	it("shows type, material, serial, quantity, actor and job in one row", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<MovementLog
							{...base}
							movements={[
								{
									id: "m1",
									type: "RELEASE",
									qty: -2,
									serial: "SN-1",
									at: "2026-09-20T12:00:00Z",
									actor: "G. Ayala",
									material: "4012210 DGA4122HP",
									job: "1-4W9K44",
									note: null,
								},
							]}
						/>
					),
				},
			],
		})
		const row = screen.getByTestId("movement-row-m1")
		for (const text of [
			"Released",
			"4012210 DGA4122HP",
			"SN-1",
			"-2",
			"G. Ayala",
			"1-4W9K44",
		]) {
			expect(row).toHaveTextContent(text)
		}
	})

	it("shows a page link to the next page of the ledger", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<MovementLog
							{...base}
							pageCount={3}
							total={45}
							movements={[
								{
									id: "m1",
									type: "RECEIVE",
									qty: 1,
									serial: null,
									at: "2026-09-20T12:00:00Z",
									actor: "A",
									material: "X",
									job: null,
									note: null,
								},
							]}
						/>
					),
				},
			],
		})
		expect(screen.getByText("1–20 of 45")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
			"href",
			"/?page=2",
		)
	})

	it("shows an empty state", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => <MovementLog {...base} total={0} movements={[]} />,
				},
			],
		})
		expect(screen.getByText("No movements yet.")).toBeInTheDocument()
	})
})
