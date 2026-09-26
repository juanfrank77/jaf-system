import { db } from "./db.server"
import { nextSerialState } from "./van-inventory-v3"

export async function releaseRestockToVan(
	restockId: string,
	serials: { serial: string; serviceCodeId: string }[],
	accessories: { serviceCodeId: string; qty: number }[],
	actor: { id: string },
): Promise<void> {
	const restock = await db.restockRequest.findUniqueOrThrow({
		where: { id: restockId },
	})
	const ops = []
	for (const s of serials) {
		const loc = await db.serialLocation.findUnique({
			where: { serial: s.serial },
		})
		const to = nextSerialState(loc?.status ?? null, "PICKUP")
		ops.push(
			db.serialLocation.upsert({
				where: { serial: s.serial },
				update: { status: to, currentRef: restock.vanId, since: new Date() },
				create: {
					serial: s.serial,
					serviceCodeId: s.serviceCodeId,
					status: to,
					currentRef: restock.vanId,
				},
			}),
		)
		ops.push(
			db.vanMovement.create({
				data: {
					vanId: restock.vanId,
					serviceCodeId: s.serviceCodeId,
					qty: 1,
					serial: s.serial,
					type: "PICKUP",
					refRestockId: restockId,
					byUserId: actor.id,
				},
			}),
		)
	}
	for (const a of accessories) {
		if (a.qty > 0)
			ops.push(
				db.vanMovement.create({
					data: {
						vanId: restock.vanId,
						serviceCodeId: a.serviceCodeId,
						qty: a.qty,
						type: "PICKUP",
						refRestockId: restockId,
						byUserId: actor.id,
					},
				}),
			)
	}
	ops.push(
		db.restockRequest.update({
			where: { id: restockId },
			data: { status: "RECEIVED", releaseId: `rel-${Date.now()}` },
		}),
	)
	await db.$transaction(ops)
}
