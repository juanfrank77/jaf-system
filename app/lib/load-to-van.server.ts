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

		// Reconcile what was actually scanned/entered against what was requested —
		// a partial scan (missed serials) must not silently close the restock as
		// RECEIVED (a terminal status with no re-release path), and an excess
		// scan must not silently over-credit the van.
		const requestedLines = restock.lines as {
			serviceCodeId: string
			qty: number
		}[]
		if (requestedLines.length === 0) {
			throw new Error(`Restock ${restockId} has no lines to release`)
		}
		const providedByCode = new Map<string, number>()
		for (const s of serials)
			providedByCode.set(
				s.serviceCodeId,
				(providedByCode.get(s.serviceCodeId) ?? 0) + 1,
			)
		for (const a of accessories)
			providedByCode.set(
				a.serviceCodeId,
				(providedByCode.get(a.serviceCodeId) ?? 0) + a.qty,
			)
		for (const line of requestedLines) {
			const provided = providedByCode.get(line.serviceCodeId) ?? 0
			if (provided !== line.qty) {
				throw new Error(
					`Release does not match restock line ${line.serviceCodeId}: requested ${line.qty}, provided ${provided}`,
				)
			}
		}
		// The loop above only checks each requested line is satisfied — it
		// never checks the converse. Without this, a release could smuggle
		// serials/accessories for a service code that was never on the
		// restock at all and still pass (every requested line matched), which
		// creates permanent phantom inventory for a code nobody asked for.
		const requestedIds = new Set(requestedLines.map((l) => l.serviceCodeId))
		for (const codeId of providedByCode.keys()) {
			if (!requestedIds.has(codeId)) {
				throw new Error(
					`Release provided serial/accessory for service code ${codeId}, which is not on restock ${restockId}`,
				)
			}
		}

		if (serials.length > 0) {
			const seen = new Set<string>()
			for (const s of serials) {
				if (seen.has(s.serial)) {
					throw new Error(`Duplicate serial ${s.serial} in release`)
				}
				seen.add(s.serial)
			}
			// One round trip for all existing rows, instead of a findUnique +
			// upsert pair per serial: every serial here goes through the same
			// PICKUP transition, so the only thing that varies per-serial is
			// whether a SerialLocation row already exists (update) or not
			// (create) — both are then batched.
			const existing = await tx.serialLocation.findMany({
				where: { serial: { in: serials.map((s) => s.serial) } },
			})
			const existingBySerial = new Map(existing.map((l) => [l.serial, l]))
			// nextSerialState's return value (not just its throw) drives the
			// writes below, so a second PICKUP-like transition target can't
			// silently diverge from what this loop actually validated. Every
			// serial here goes through the same "PICKUP" event, and a
			// transition's target status depends only on the event, never on
			// the current status, so one shared value is correct.
			const [targetStatus] = serials.map((s) =>
				nextSerialState(
					existingBySerial.get(s.serial)?.status ?? null,
					"PICKUP",
				),
			)
			const existingSerials = existing.map((l) => l.serial)
			if (existingSerials.length > 0) {
				await tx.serialLocation.updateMany({
					where: { serial: { in: existingSerials } },
					data: {
						status: targetStatus,
						currentRef: restock.vanId,
						since: new Date(),
					},
				})
			}
			const newSerials = serials.filter((s) => !existingBySerial.has(s.serial))
			if (newSerials.length > 0) {
				await tx.serialLocation.createMany({
					data: newSerials.map((s) => ({
						serial: s.serial,
						serviceCodeId: s.serviceCodeId,
						status: targetStatus,
						currentRef: restock.vanId,
					})),
				})
			}
			await tx.vanMovement.createMany({
				data: serials.map((s) => ({
					vanId: restock.vanId,
					serviceCodeId: s.serviceCodeId,
					qty: 1,
					serial: s.serial,
					type: "PICKUP" as const,
					refRestockId: restockId,
					byUserId: actor.id,
				})),
			})
		}
		const positiveAccessories = accessories.filter((a) => a.qty > 0)
		if (positiveAccessories.length > 0) {
			await tx.vanMovement.createMany({
				data: positiveAccessories.map((a) => ({
					vanId: restock.vanId,
					serviceCodeId: a.serviceCodeId,
					qty: a.qty,
					type: "PICKUP" as const,
					refRestockId: restockId,
					byUserId: actor.id,
				})),
			})
		}
	})
}
