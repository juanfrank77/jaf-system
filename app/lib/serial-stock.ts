import { db } from "~/lib/db.server"

// On-hand = serials physically in the warehouse (status WAREHOUSE).
// SENT_FOR_REPAIR / AWAITING_REPAIR / NEEDS_REVIEW / LOST are excluded.
export async function serializedOnHand(warehouseId: string) {
	const grouped = await db.serialLocation.groupBy({
		by: ["serviceCodeId", "condition"],
		where: { status: "WAREHOUSE", currentRef: warehouseId },
		_count: true,
	})
	return grouped.map((g) => ({
		serviceCodeId: g.serviceCodeId,
		condition: g.condition,
		count: g._count,
	}))
}

export const repairPoolCount = (warehouseId: string) =>
	db.serialLocation.count({
		where: { status: "AWAITING_REPAIR", currentRef: warehouseId },
	})

export const needsReviewCount = (warehouseId: string) =>
	db.serialLocation.count({
		where: { status: "NEEDS_REVIEW", currentRef: warehouseId },
	})
