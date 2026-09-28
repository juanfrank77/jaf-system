import { db } from "~/lib/db.server"
import {
	createSnapshot,
	generateSnapshotArtifacts,
} from "~/lib/stock-snapshot.server"
import { requireWarehouseLead } from "~/lib/warehouse-lead.server"
import type { Route } from "./+types/_app.warehouse.stock.snapshot"

// Lead-gated. The row is written synchronously; PDF/CSV render fires async so a
// generation failure never blocks the response — `intent=regenerate` retries.
//
// A failed async render leaves `documentPath`/`csvPath` null on the committed
// StockSnapshot row, and SnapshotPanel renders the Regenerate button (instead
// of the PDF/CSV links) for exactly that state — so the failure is visible and
// recoverable in the UI after a reload, not silently lost with the log line.
export async function action({ request }: Route.ActionArgs) {
	const form = await request.formData()
	const warehouseId = String(form.get("warehouseId"))
	const { user } = await requireWarehouseLead(request, warehouseId)
	const intent = String(form.get("intent") ?? "create")

	if (intent === "regenerate") {
		const snapshotId = String(form.get("snapshotId"))
		generateSnapshotArtifacts(db, snapshotId).catch((e) => {
			// biome-ignore lint/suspicious/noConsole: async artifact-gen failure log
			console.error("snapshot regen failed", e)
		})
		return { ok: true as const }
	}

	const asOfDate = form.get("asOfDate")
		? new Date(String(form.get("asOfDate")))
		: new Date()
	const snap = await createSnapshot(db, {
		warehouseId,
		asOfDate,
		userId: user.id,
	})
	generateSnapshotArtifacts(db, snap.id).catch((e) => {
		// biome-ignore lint/suspicious/noConsole: async artifact-gen failure log
		console.error("snapshot gen failed", e)
	})
	return { ok: true as const, snapshotId: snap.id }
}
