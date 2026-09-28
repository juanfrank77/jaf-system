import { redirect } from "react-router"
import { db } from "~/lib/db.server"
import { requireRole } from "~/lib/permissions.server"

export async function isWarehouseLead(userId: string, warehouseId: string) {
	const a = await db.warehouseAssignment.findUnique({
		where: { userId_warehouseId: { userId, warehouseId } },
		select: { isLead: true },
	})
	return a?.isLead === true
}

export async function requireWarehouseLead(
	request: Request,
	warehouseId: string,
) {
	const { user } = await requireRole(request, ["WAREHOUSE", "ADMIN"])
	if (user.role === "ADMIN") return { user }
	if (await isWarehouseLead(user.id, warehouseId)) return { user }
	throw redirect("/dashboard")
}
