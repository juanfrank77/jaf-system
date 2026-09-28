import { db } from "~/lib/db.server"

/**
 * The warehouse a user acts in. Spec A assumes a single assignment per
 * warehouse worker; Spec B adds the multi-warehouse header switch on top of
 * this. Throws when the user has no assignment (callers gate on WAREHOUSE role
 * first, and warehouse workers are seeded with an assignment).
 */
export async function getActiveWarehouseId(userId: string): Promise<string> {
	const a = await db.warehouseAssignment.findFirst({
		where: { userId },
		orderBy: { createdAt: "asc" },
		select: { warehouseId: true },
	})
	if (!a) throw new Error(`user ${userId} has no warehouse assignment`)
	return a.warehouseId
}
