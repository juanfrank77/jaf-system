import { db } from "~/lib/db.server"
import { runOnce } from "~/lib/idempotency.server"
import { requireRole } from "~/lib/permissions.server"
import { isWarehouseMember } from "~/lib/warehouse-scope.server"
import type { Route } from "./+types/_app.warehouse.stock.receive"

type DeliveryLine = { serviceCodeId: string; qty: number }

// Action-only route: the stock screen posts a delivery here. One StockDelivery
// + one RECEIVE bulk movement (+qty) per line, in a single transaction.
//
// Receiving is a COUNTER-level action (spec §5), so it is not lead-gated —
// but `warehouseId` arrives in the POST body, so the acting user must still be
// assigned to it, or any warehouse user could fabricate RECEIVE movements into
// an arbitrary warehouse's ledger. Lines are validated against the active
// catalog (same pattern as the returns action), and the whole thing runs under
// an idempotency key so a double submit cannot double-count bulk on-hand.
export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const form = await request.formData()
	const warehouseId = String(form.get("warehouseId") ?? "").trim()
	if (!warehouseId) {
		return { errorKey: "stock.receive.errors.warehouse_required" as const }
	}
	if (
		user.role !== "ADMIN" &&
		!(await isWarehouseMember(user.id, warehouseId))
	) {
		return { errorKey: "stock.receive.errors.not_assigned" as const }
	}

	const idempotencyKey = String(form.get("idempotencyKey") ?? "").trim()
	if (!idempotencyKey) {
		return {
			errorKey: "stock.receive.errors.idempotency_key_required" as const,
		}
	}

	let lines: DeliveryLine[] = []
	try {
		const parsed: unknown = JSON.parse(String(form.get("lines") ?? "[]"))
		if (!Array.isArray(parsed)) throw new Error("not an array")
		lines = parsed as DeliveryLine[]
	} catch {
		return { errorKey: "stock.receive.errors.invalid_lines" as const }
	}

	for (const l of lines) {
		if (!l || typeof l.serviceCodeId !== "string" || !l.serviceCodeId) {
			return { errorKey: "stock.receive.errors.invalid_lines" as const }
		}
		// A negative/fractional qty used to be silently Math.abs'd into a credit.
		if (!Number.isInteger(l.qty) || l.qty < 0) {
			return { errorKey: "stock.receive.errors.invalid_qty" as const }
		}
	}

	const uniqueIds = [...new Set(lines.map((l) => l.serviceCodeId))]
	if (uniqueIds.length > 0) {
		const valid = await db.serviceCode.findMany({
			where: { id: { in: uniqueIds }, active: true },
			select: { id: true },
		})
		if (valid.length !== uniqueIds.length) {
			return { errorKey: "stock.receive.errors.invalid_service_codes" as const }
		}
	}

	const out = await runOnce(db, idempotencyKey, "receive", async (tx) => {
		const delivery = await tx.stockDelivery.create({
			data: {
				warehouseId,
				receivedById: user.id,
				reference: form.get("reference") ? String(form.get("reference")) : null,
			},
		})
		for (const l of lines) {
			if (!l.qty) continue // nothing to receive
			await tx.stockMovement.create({
				data: {
					kind: "BULK",
					type: "RECEIVE",
					warehouseId,
					serviceCodeId: l.serviceCodeId,
					qty: l.qty,
					byUserId: user.id,
					refDeliveryId: delivery.id,
				},
			})
		}
	})
	return { ok: true as const, deduped: out.deduped }
}
