import { db } from "./db.server"
import { nextSerialState } from "./van-inventory-v3"

export async function scanInReturn(
	serial: string,
	warehouseId: string,
	actor: { id: string },
): Promise<{ ok: boolean; reason?: string }> {
	const loc = await db.serialLocation.findUnique({ where: { serial } })
	if (!loc || loc.status !== "REMOVED_PENDING_RETURN")
		return { ok: false, reason: "NOT_OWED_BACK" }
	const fromVanId = loc.currentRef
	await db.$transaction([
		db.serialLocation.update({
			where: { serial },
			data: {
				status: nextSerialState(loc.status, "RETURN"),
				currentRef: warehouseId,
				since: new Date(),
			},
		}),
		db.vanMovement.create({
			data: {
				vanId: fromVanId,
				serviceCodeId: loc.serviceCodeId,
				qty: -1,
				serial,
				type: "RETURN",
				byUserId: actor.id,
			},
		}),
	])
	return { ok: true }
}
