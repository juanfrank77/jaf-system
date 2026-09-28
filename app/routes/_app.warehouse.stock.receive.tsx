import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"
import type { Route } from "./+types/_app.warehouse.stock.receive"

// Action-only route: the stock screen posts a delivery here. One StockDelivery
// + one RECEIVE bulk movement (+qty) per line, in a single transaction.
export async function action({ request }: Route.ActionArgs) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	const form = await request.formData()
	const warehouseId = String(form.get("warehouseId"))
	const lines = JSON.parse(String(form.get("lines"))) as {
		serviceCodeId: string
		qty: number
	}[]
	await db.$transaction(async (tx) => {
		const delivery = await tx.stockDelivery.create({
			data: {
				warehouseId,
				receivedById: user.id,
				reference: form.get("reference") ? String(form.get("reference")) : null,
			},
		})
		for (const l of lines) {
			await tx.stockMovement.create({
				data: {
					kind: "BULK",
					type: "RECEIVE",
					warehouseId,
					serviceCodeId: l.serviceCodeId,
					qty: Math.abs(l.qty),
					byUserId: user.id,
					refDeliveryId: delivery.id,
				},
			})
		}
	})
	return { ok: true }
}
