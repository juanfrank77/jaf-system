import { db } from "~/lib/db.server"

export type Disposition = "FAILED" | "GOOD" | "NEEDS_REVIEW"

const FAILURE_REASONS = new Set(["HARDWARE", "INSTALL_DEFECT", "LINE"])
const DISPO_TO_STATUS = {
	FAILED: "AWAITING_REPAIR",
	GOOD: "WAREHOUSE",
	NEEDS_REVIEW: "NEEDS_REVIEW",
} as const

export async function computeTriagePrefill(
	serial: string,
): Promise<Disposition> {
	const swap = await db.swapEvent.findFirst({
		where: { serialOut: serial },
		orderBy: { submittedAt: "desc" },
		select: { reason: true },
	})
	if (swap && FAILURE_REASONS.has(swap.reason)) return "FAILED"
	if (!swap) return "GOOD" // never installed via swap-out → returned unused van stock
	return "NEEDS_REVIEW" // removed from a customer in working order
}

export async function dispositionSerial(args: {
	serial: string
	disposition: Disposition
	reason?: string
	byUserId: string
	warehouseId: string
}) {
	const nextStatus = DISPO_TO_STATUS[args.disposition]
	const result = await db.$transaction(async (tx) => {
		const updated = await tx.serialLocation.updateMany({
			where: { serial: args.serial, status: "RETURNED" },
			data: {
				status: nextStatus,
				currentRef: args.warehouseId,
				since: new Date(),
			},
		})
		if (updated.count !== 1)
			throw new Error(`serial ${args.serial}: expected status RETURNED`)
		const sl = await tx.serialLocation.findUniqueOrThrow({
			where: { serial: args.serial },
			select: { serviceCodeId: true },
		})
		await tx.stockMovement.create({
			data: {
				kind: "SERIAL",
				type: "DISPOSITION",
				serial: args.serial,
				qty: 0,
				serviceCodeId: sl.serviceCodeId,
				warehouseId: args.warehouseId,
				byUserId: args.byUserId,
				at: new Date(),
				note: `${args.disposition}${args.reason ? `: ${args.reason}` : ""}`,
			},
		})
		return { status: nextStatus }
	})
	// Spec §8: a unit held for review notifies the warehouse lead(s) of that warehouse.
	if (args.disposition === "NEEDS_REVIEW") {
		const leads = await db.warehouseAssignment.findMany({
			where: { warehouseId: args.warehouseId, isLead: true },
			select: { userId: true },
		})
		if (leads.length) {
			await db.notification.createMany({
				data: leads.map((l) => ({
					userId: l.userId,
					message: `Serial ${args.serial} is held for review before repair disposition.`,
				})),
			})
		}
	}
	return result
}
