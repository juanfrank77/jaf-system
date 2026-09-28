import { db } from "~/lib/db.server"
import type { Prisma } from "../../generated/prisma/client"

type DB = Prisma.TransactionClient | typeof db

function readCookie(header: string | null, name: string): string | undefined {
	return header
		?.split(";")
		.map((c) => c.trim().split("="))
		.find(([k]) => k === name)?.[1]
}

/**
 * The set of warehouses a user may act in and which one is currently selected.
 * Visible = the user's assignments (ADMIN sees all active); the selection comes
 * from the `wh` cookie when it is in the visible set, else the first. Spec B's
 * multi-warehouse switch (Task 4) and every warehouse-scoped query read this.
 */
export async function resolveWarehouseScope(
	client: DB,
	request: Request,
	user: { id: string; role: string },
) {
	const warehouses =
		user.role === "ADMIN"
			? await client.warehouse.findMany({
					where: { active: true },
					select: { id: true, name: true },
				})
			: (
					await client.warehouseAssignment.findMany({
						where: { userId: user.id },
						include: { warehouse: { select: { id: true, name: true } } },
					})
				).map((a) => a.warehouse)
	const cookieId = readCookie(request.headers.get("cookie"), "wh")
	const selectedId =
		warehouses.find((w) => w.id === cookieId)?.id ?? warehouses[0]?.id
	return { warehouses, selectedId }
}

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
