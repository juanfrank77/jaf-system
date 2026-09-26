import { db } from "./db.server"
import { nextSerialState } from "./van-inventory-v3"

export async function releaseRestockToVan(
	restockId: string,
	serials: { serial: string; serviceCodeId: string }[],
	accessories: { serviceCodeId: string; qty: number }[],
	actor: { id: string },
): Promise<void> {
	await db.$transaction(async (tx) => {
		// Atomic status guard: only a SUBMITTED/APPROVED restock may be released,
		// and this transitions it to RECEIVED in the same write, so a concurrent
		// or replayed release (refresh, double-click, back-button) can never
		// succeed twice — updateMany's count tells us who won.
		const claimed = await tx.restockRequest.updateMany({
			where: { id: restockId, status: { in: ["SUBMITTED", "APPROVED"] } },
			data: { status: "RECEIVED", releaseId: `rel-${Date.now()}` },
		})
		if (claimed.count === 0) {
			throw new Error(
				"Restock is not releasable (already released, or still awaiting sign-off)",
			)
		}
		const restock = await tx.restockRequest.findUniqueOrThrow({
			where: { id: restockId },
		})

		for (const s of serials) {
			const loc = await tx.serialLocation.findUnique({
				where: { serial: s.serial },
			})
			const to = nextSerialState(loc?.status ?? null, "PICKUP")
			await tx.serialLocation.upsert({
				where: { serial: s.serial },
				update: { status: to, currentRef: restock.vanId, since: new Date() },
				create: {
					serial: s.serial,
					serviceCodeId: s.serviceCodeId,
					status: to,
					currentRef: restock.vanId,
				},
			})
			await tx.vanMovement.create({
				data: {
					vanId: restock.vanId,
					serviceCodeId: s.serviceCodeId,
					qty: 1,
					serial: s.serial,
					type: "PICKUP",
					refRestockId: restockId,
					byUserId: actor.id,
				},
			})
		}
		for (const a of accessories) {
			if (a.qty > 0)
				await tx.vanMovement.create({
					data: {
						vanId: restock.vanId,
						serviceCodeId: a.serviceCodeId,
						qty: a.qty,
						type: "PICKUP",
						refRestockId: restockId,
						byUserId: actor.id,
					},
				})
		}
	})
}
