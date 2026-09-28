import { db } from "~/lib/db.server"
import { runOnce } from "~/lib/idempotency.server"
import { requireWarehouseLead } from "~/lib/warehouse-lead.server"
import type { Route } from "./+types/_app.warehouse.stock.adjust"

// Lead-gated, reason-required, idempotent bulk correction: one ADJUST movement
// (qty = signed delta) with the reason stored in `note`. A replayed submit
// (same idempotencyKey) posts nothing.
export async function action({ request }: Route.ActionArgs) {
	const form = await request.formData()
	const warehouseId = String(form.get("warehouseId"))
	const { user } = await requireWarehouseLead(request, warehouseId)
	const reason = String(form.get("reason") ?? "").trim()
	if (!reason) return { errorKey: "adjust.reason_required" as const }
	const delta = Number(form.get("delta"))
	const serviceCodeId = String(form.get("serviceCodeId"))
	const key = String(form.get("idempotencyKey"))
	const out = await runOnce(db, key, "adjust", async (tx) => {
		await tx.stockMovement.create({
			data: {
				kind: "BULK",
				type: "ADJUST",
				warehouseId,
				serviceCodeId,
				qty: delta,
				note: reason,
				byUserId: user.id,
			},
		})
	})
	return { ok: true as const, deduped: out.deduped }
}
