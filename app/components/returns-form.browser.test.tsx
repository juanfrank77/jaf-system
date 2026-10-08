import { screen, waitFor } from "@testing-library/react"
import { useActionData, useLoaderData } from "react-router"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import {
	ReturnsForm,
	type ReturnsFormActionData,
	type ReturnsFormData,
} from "./returns-form"

function loaderData(): ReturnsFormData {
	return {
		doc: { controlNumber: "JAF-2026-1004" },
		serviceCodes: [
			{
				id: "sc-1",
				claroCode: "34006428",
				name: "SPLICE ENCLOSURE",
				unit: "EA",
				unitPrice: 12.5,
			},
		],
		taken: [{ serviceCodeId: "sc-1", qty: 40 }],
		materialsUsed: [{ serviceCodeId: "sc-1", qty: 0 }],
		warehouses: [{ id: "wh-1", name: "Guaynabo" }],
		pickupWarehouseId: "wh-1",
	}
}

describe("ReturnsForm — post-success resubmit (review fix)", () => {
	it("resets the received qty and note after a successful confirm, so a second click posts a fresh (non-stale) return instead of resubmitting the same short data", async ({
		renderStub,
	}) => {
		const submittedLines: { serviceCodeId: string; received: number }[][] = []

		await renderStub({
			entries: [
				{
					path: "/",
					loader: async () => loaderData(),
					action: async ({ request }) => {
						const form = await request.formData()
						submittedLines.push(JSON.parse(String(form.get("lines"))))
						return { ok: true, deduped: false } as ReturnsFormActionData
					},
					Component: () => {
						const data = useLoaderData() as ReturnsFormData
						const actionData = useActionData() as
							| ReturnsFormActionData
							| undefined
						return <ReturnsForm loaderData={data} actionData={actionData} />
					},
				},
			],
		})

		// Pre-filled expected-back is 40 (taken 40 − used 0) — short it to 30 and
		// supply the now-required discrepancy note.
		const receivedInput = screen.getByLabelText("Returned Qty")
		await userEvent.clear(receivedInput)
		await userEvent.type(receivedInput, "30")
		await userEvent.type(
			screen.getByLabelText(/Return \/ Shortage Note/),
			"1 damaged on site",
		)
		await userEvent.click(screen.getByRole("button", { name: "Save Returns" }))

		await waitFor(() => {
			expect(screen.getByText("Returns logged.")).toBeInTheDocument()
		})
		expect(submittedLines).toEqual([[{ serviceCodeId: "sc-1", received: 30 }]])

		// The bug this covers: lines/note state lived outside the keyed <Form>,
		// so it survived the post-success idempotency-key rotation untouched —
		// a second click would silently repost the same short "received: 30"
		// under a brand-new (non-deduped) key, double-crediting the ledger for
		// data that was already confirmed once.
		await waitFor(() => {
			expect(screen.getByLabelText("Returned Qty")).toHaveValue(40)
		})
		expect(screen.getByLabelText(/Return \/ Shortage Note/)).toHaveValue("")

		// A second click with no further edits now submits the reset (fresh,
		// full, non-short) state — never a repeat of the already-confirmed
		// `received: 30` payload.
		await userEvent.click(screen.getByRole("button", { name: "Save Returns" }))

		await waitFor(() => {
			expect(submittedLines).toHaveLength(2)
		})
		expect(submittedLines[1]).toEqual([{ serviceCodeId: "sc-1", received: 40 }])
		expect(submittedLines[0]).not.toEqual(submittedLines[1])
	})

	it("prefills the ALREADY-SAVED returns on a revisit and disables resubmitting", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					loader: async () => ({
						...loaderData(),
						savedReturns: [
							{
								serviceCodeId: "sc-1",
								takenQty: 40,
								returnedQty: 30,
								notes: "",
							},
						],
						alreadyRecorded: true,
					}),
					Component: () => {
						const data = useLoaderData() as ReturnsFormData
						return <ReturnsForm loaderData={data} />
					},
				},
			],
		})
		// 30 (what was saved), not 40 (the full expected-back default) — a blank
		// full form here is exactly what let a second click double-credit.
		expect(screen.getByLabelText("Returned Qty")).toHaveValue(30)
		expect(screen.getByTestId("returns-already-recorded")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Save Returns" })).toBeDisabled()
	})

	it("shows the translated serial reason in the closed select, not the raw enum", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					loader: async () => loaderData(),
					Component: () => {
						const data = useLoaderData() as ReturnsFormData
						return <ReturnsForm loaderData={data} actionData={undefined} />
					},
				},
			],
		})

		await userEvent.click(
			screen.getByRole("button", { name: "+ Add Serial Line" }),
		)
		const reasonTrigger = () =>
			screen.getAllByRole("combobox").at(-1) as HTMLElement
		await userEvent.click(reasonTrigger())
		await userEvent.click(await screen.findByRole("option", { name: "Lost" }))

		await waitFor(() => {
			expect(reasonTrigger()).toHaveTextContent("Lost")
		})
		expect(screen.queryByText("LOST")).not.toBeInTheDocument()
	})
})
