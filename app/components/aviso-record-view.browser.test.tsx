import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { summarizeAviso } from "~/lib/aviso-summary"
import { AvisoRecordView } from "./aviso-record-view"

const d = (s: string) => new Date(`${s}T12:00:00Z`)

describe("AvisoRecordView", () => {
	it("shows the money cards, each date with its source, MISSING in red, and the documents", async ({
		renderStub,
	}) => {
		const aviso = summarizeAviso(
			{
				id: "a",
				avisoNumber: "10351234",
				controlNumber: "JAF-1",
				address: "Calle 1",
				supervisor: "E. Ocasio",
				brigades: [],
				zone: null,
				jobCompletedAt: d("2026-05-01"),
				lines: [{ qty: 1, unitPrice: 717.49 }],
				releasedAt: d("2026-05-02"),
				acceptedAt: null,
				soldAt: d("2026-05-06"),
				batchNumber: 2,
				payrollRequestAt: null,
				brigadePaidAt: null,
				armBClosedAt: null,
				pos: [
					{
						poId: "p1",
						poNumber: "4500526054",
						poDate: d("2026-09-04"),
						poSubtotal: 717.49,
						poTotal: 800,
						poConfirmedAt: d("2026-09-04"),
						termsDays: 60,
						invoice: null,
					},
				],
			},
			d("2026-10-30"),
		)
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<AvisoRecordView
							aviso={aviso}
							documents={[{ label: "PO 4500526054", href: "/x" }]}
							history={[
								{
									id: "h",
									action: "PO_CONFIRMED",
									at: "2026-09-04T12:00:00.000Z",
									by: "Lissette",
									source: "STAMPED",
								},
							]}
						/>
					),
				},
			],
		})
		expect(await screen.findByText("Aviso 10351234")).toBeInTheDocument()
		expect(screen.getAllByText("$800.00").length).toBeGreaterThan(0)
		// Sold but never accepted: that date shows MISSING.
		expect(screen.getByText("MISSING")).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "PO 4500526054" })).toHaveAttribute(
			"href",
			"/x",
		)
		expect(screen.getByText(/PO_CONFIRMED/)).toBeInTheDocument()
	})
})
