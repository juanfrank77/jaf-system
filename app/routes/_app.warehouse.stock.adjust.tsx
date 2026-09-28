import { db } from "~/lib/db.server"
import { runOnce } from "~/lib/idempotency.server"
import { requireWarehouseLead } from "~/lib/warehouse-lead.server"
import type { Route } from "./+types/_app.warehouse.stock.adjust"

// Lead-gated, reason-required, idempotent bulk correction: one ADJUST movement
// (qty = signed delta) with the reason stored in `note`. A replayed submit
// (same idempotencyKey) posts nothing.
export async function action({ request }: Route.ActionArgs) {
	const form = await request.formData()
	const warehouseId = String(form.get("warehouseId") ?? "").trim()
	const { user } = await requireWarehouseLead(request, warehouseId)
	const reason = String(form.get("reason") ?? "").trim()
	if (!reason) return { errorKey: "adjust.reason_required" as const }
	const delta = Number(form.get("delta"))
	if (!Number.isInteger(delta) || delta === 0) {
		return { errorKey: "adjust.invalid_delta" as const }
	}
	const serviceCodeId = String(form.get("serviceCodeId") ?? "").trim()
	// Unvalidated, `serviceCodeId` would post an ADJUST against a non-existent
	// (or retired) material — an on-hand figure nothing can reconcile.
	const code = serviceCodeId
		? await db.serviceCode.findFirst({
				where: { id: serviceCodeId, active: true },
				select: { id: true },
			})
		: null
	if (!code) return { errorKey: "adjust.invalid_service_code" as const }

	// `String(form.get(...))` on a MISSING field yields the literal "null" — a
	// fixed key shared by every request without the field, so the first such
	// adjust succeeded and every later one silently deduped while reporting
	// success. Require a real key instead of coercing.
	const rawKey = form.get("idempotencyKey")
	const key = typeof rawKey === "string" ? rawKey.trim() : ""
	if (!key) return { errorKey: "adjust.idempotency_key_required" as const }

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
