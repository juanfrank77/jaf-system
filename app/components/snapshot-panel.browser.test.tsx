import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import { SnapshotPanel, type SnapshotRowData } from "./snapshot-panel"

describe("SnapshotPanel", () => {
	it("shows PDF/CSV download links once the artifacts have been generated", async ({
		renderStub,
	}) => {
		const snapshots: SnapshotRowData[] = [
			{
				id: "snap-1",
				warehouseId: "wh-1",
				asOfDate: "2026-09-20T00:00:00Z",
				documentPath: "/uploads/snapshots/snap-1.pdf",
				csvPath: "/uploads/snapshots/snap-1.csv",
			},
		]
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<SnapshotPanel warehouseId="wh-1" snapshots={snapshots} />
					),
				},
			],
		})
		expect(screen.getByRole("link", { name: "PDF" })).toHaveAttribute(
			"href",
			"/files/snapshots/snap-1.pdf",
		)
		expect(screen.getByRole("link", { name: "CSV" })).toHaveAttribute(
			"href",
			"/files/snapshots/snap-1.csv",
		)
	})

	it("offers Regenerate instead of a broken link while artifacts are still pending", async ({
		renderStub,
	}) => {
		const snapshots: SnapshotRowData[] = [
			{
				id: "snap-2",
				warehouseId: "wh-1",
				asOfDate: "2026-09-21T00:00:00Z",
				documentPath: null,
				csvPath: null,
			},
		]
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => (
						<SnapshotPanel warehouseId="wh-1" snapshots={snapshots} />
					),
				},
				{
					path: "/warehouse/stock/snapshot",
					action: async () => ({ ok: true }),
					Component: () => null,
				},
			],
		})
		expect(screen.queryByRole("link", { name: "PDF" })).not.toBeInTheDocument()
		const regenerate = screen.getByRole("button", { name: "Regenerate" })
		await userEvent.click(regenerate)
		await waitFor(() => {
			expect(regenerate).toBeInTheDocument()
		})
	})

	it("shows an empty state when there are no snapshots yet", async ({
		renderStub,
	}) => {
		await renderStub({
			entries: [
				{
					path: "/",
					Component: () => <SnapshotPanel warehouseId="wh-1" snapshots={[]} />,
				},
			],
		})
		expect(screen.getByText("No snapshots yet.")).toBeInTheDocument()
	})
})
