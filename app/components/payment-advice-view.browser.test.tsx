import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PaymentAdviceView } from "./payment-advice-view"

const line = (over: object) => ({
	id: "l1",
	invoiceRef: "M19-3423",
	voucher: "5920050318",
	invoiceDate: "2026-07-03T12:00:00.000Z",
	net: 100,
	ourTotal: 100,
	result: "MATCHED" as const,
	otherJaf: false,
	invoiceId: "i1",
	needsAccept: false,
	...over,
})

const card = (over: object = {}) => ({
	id: "a1",
	adviceDate: "2026-10-01T12:00:00.000Z",
	bank: "Banco Santander PR",
	reference: "5440033483",
	total: 190,
	rowsTotal: 190,
	totalOk: true,
	applied: false,
	lines: [
		line({}),
		line({
			id: "l2",
			invoiceRef: "M19-3424",
			net: 90,
			ourTotal: 100,
			result: "SHORT",
			otherJaf: false,
			invoiceId: "i2",
		}),
		line({
			id: "l3",
			invoiceRef: "M19-9999",
			result: "UNMATCHED",
			otherJaf: false,
			invoiceId: null,
			ourTotal: null,
		}),
	],
	...over,
})

describe("PaymentAdviceView", () => {
	it("shows match results, invoice dates month-first, the short difference and Apply", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<PaymentAdviceView
							counts={{ pending: 1, applied: 0, unmatched: 1 }}
							tab="upload"
							advices={[card()]}
							unmatched={[]}
						/>
					),
				},
			],
		})
		expect(await screen.findByText("Match → closes PO")).toBeInTheDocument()
		expect(screen.getByText("Short paid $10.00")).toBeInTheDocument()
		expect(screen.getByText("Not in system")).toBeInTheDocument()
		expect(screen.getAllByText("07/03/2026").length).toBeGreaterThan(0)
		expect(screen.getByRole("button", { name: "Apply payments" })).toBeEnabled()
	})

	it("disables Apply when the rows do not add to the total", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<PaymentAdviceView
							counts={{ pending: 1, applied: 0, unmatched: 0 }}
							tab="upload"
							advices={[card({ totalOk: false, rowsTotal: 180 })]}
							unmatched={[]}
						/>
					),
				},
			],
		})
		expect(
			await screen.findByRole("button", { name: "Apply payments" }),
		).toBeDisabled()
	})
	it("on Carmen's desk marks an unmatched JA row for a person, with no M19 link form, and shows the real shortfall", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<PaymentAdviceView
							kind="ja"
							counts={{ pending: 0, applied: 1, unmatched: 1 }}
							tab="applied"
							advices={[
								card({
									applied: true,
									lines: [
										line({
											id: "j1",
											invoiceRef: "JA1616329",
											net: 1857.61,
											ourTotal: 1895.06,
											result: "SHORT",
											otherJaf: true,
											invoiceId: null,
											needsAccept: true,
										}),
										line({
											id: "j2",
											invoiceRef: "JA1616999",
											result: "UNMATCHED",
											otherJaf: true,
											invoiceId: null,
											ourTotal: null,
										}),
									],
								}),
							]}
							unmatched={[]}
						/>
					),
				},
			],
		})
		expect(await screen.findByText("Short paid $37.45")).toBeInTheDocument()
		expect(screen.getByText("Needs a person to check")).toBeInTheDocument()
		expect(screen.queryByPlaceholderText("M19-0000")).not.toBeInTheDocument()
		expect(
			screen.getByRole("button", { name: "Accept short pay" }),
		).toBeInTheDocument()
	})

	it("titles a card with this desk's rows and total, the other desk's apart, and says when a JA row only waits on its PO", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<PaymentAdviceView
							kind="ja"
							counts={{ pending: 1, applied: 0, unmatched: 1 }}
							tab="upload"
							advices={[
								card({
									total: 590,
									rowsTotal: 590,
									deskTotal: 200,
									otherCount: 2,
									otherTotal: 390,
									lines: [
										line({
											id: "j1",
											invoiceRef: "JA1616329",
											net: 200,
											result: "UNMATCHED",
											otherJaf: true,
											invoiceId: null,
											ourTotal: null,
											jaNoPo: true,
										}),
									],
								}),
							]}
							unmatched={[]}
						/>
					),
				},
			],
		})
		expect(
			await screen.findByText(
				/Ref 5440033483 · 1 rows · \$200\.00 · 2 rows on the other desk · \$390\.00/,
			),
		).toBeInTheDocument()
		expect(
			screen.getByText(
				"The installer invoice exists but has no PO yet. Add its PO and this row is matched.",
			),
		).toBeInTheDocument()
	})
})
