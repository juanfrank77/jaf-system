import { screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ClaroCloseView } from "./claro-close-view"

const line = (over: object) => ({
	id: "l1",
	invoiceRef: "M19-3423",
	voucher: "5920050318",
	net: 100,
	ourTotal: null,
	result: "UNMATCHED" as const,
	invoiceId: null,
	needsAccept: false,
	...over,
})

const advice = {
	id: "a1",
	adviceDate: "2026-10-01T12:00:00.000Z",
	reference: "5440033483",
	total: 300,
	rowsTotal: 300,
	totalOk: true,
	lines: [
		line({}),
		line({ id: "l2", invoiceRef: "M20-004" }),
		line({
			id: "l3",
			invoiceRef: "M19-3424",
			result: "MATCHED",
			invoiceId: "i3",
			ourTotal: 100,
		}),
	],
}

const addOldFor = (row: HTMLElement) =>
	within(row).queryByRole("button", { name: "Add as old invoice" })

describe("ClaroCloseView", () => {
	it("offers Add as old invoice on unmatched M19 rows only, here and on earlier statements", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<ClaroCloseView
							advices={[advice]}
							unmatched={[
								{
									id: "u1",
									invoiceRef: "M193440",
									net: 50,
									adviceDate: "2026-09-01T12:00:00.000Z",
								},
								{
									id: "u2",
									invoiceRef: "M20-009",
									net: 60,
									adviceDate: "2026-09-01T12:00:00.000Z",
								},
							]}
							shorts={[]}
						/>
					),
				},
			],
		})
		const rowOf = (text: string) =>
			(screen.getByText(text, { exact: false }).closest("tr") ??
				screen.getByText(text).closest("li")) as HTMLElement
		await screen.findByText("M19-3423", { exact: false })
		expect(addOldFor(rowOf("M19-3423 "))).toBeInTheDocument()
		expect(addOldFor(rowOf("M20-004 "))).toBeNull()
		expect(addOldFor(rowOf("M193440"))).toBeInTheDocument()
		expect(addOldFor(rowOf("M20-009"))).toBeNull()
		// A matched M19 row needs nothing added.
		expect(
			screen.getAllByRole("button", { name: "Add as old invoice" }),
		).toHaveLength(2)
		const form = addOldFor(rowOf("M193440"))?.closest("form") as HTMLElement
		expect(within(form).getByDisplayValue("add_old").getAttribute("name")).toBe(
			"intent",
		)
		expect(within(form).getByDisplayValue("u1").getAttribute("name")).toBe(
			"lineId",
		)
	})

	it("shows the old-invoice errors in words", async ({ renderStub }) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<ClaroCloseView
							advices={[]}
							unmatched={[]}
							shorts={[]}
							errorKey="claro.errors.ja_line"
						/>
					),
				},
			],
		})
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"installer (JA) row",
		)
	})
})
