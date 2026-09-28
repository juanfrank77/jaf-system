import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { db } from "~/lib/db.server"
import { generateRepairBatchPdf } from "~/lib/pdf/repair-batch.server"

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

export async function createRepairBatch(args: {
	serials: string[]
	warehouseId: string
	byUserId: string
	claroReference?: string
}) {
	if (args.serials.length === 0) throw new Error("no serials selected")
	return db.$transaction(async (tx) => {
		const batch = await tx.repairBatch.create({
			data: {
				warehouseId: args.warehouseId,
				status: "SENT",
				createdById: args.byUserId,
				sentAt: new Date(),
				claroReference: args.claroReference,
			},
		})
		for (const serial of args.serials) {
			const sl = await tx.serialLocation.findUnique({
				where: { serial },
				select: { serviceCodeId: true, currentRef: true, status: true },
			})
			if (sl?.status !== "AWAITING_REPAIR")
				throw new Error(`serial ${serial}: expected status AWAITING_REPAIR`)
			if (sl.currentRef !== args.warehouseId)
				throw new Error(`serial ${serial}: different warehouse`)
			const moved = await tx.serialLocation.updateMany({
				where: { serial, status: "AWAITING_REPAIR" },
				data: {
					status: "SENT_FOR_REPAIR",
					currentRef: batch.id,
					since: new Date(),
				},
			})
			if (moved.count !== 1)
				throw new Error(`serial ${serial}: expected status AWAITING_REPAIR`)
			await tx.stockMovement.create({
				data: {
					kind: "SERIAL",
					type: "SENT_FOR_REPAIR",
					serial,
					qty: 0,
					serviceCodeId: sl.serviceCodeId,
					warehouseId: args.warehouseId,
					refRepairBatchId: batch.id,
					byUserId: args.byUserId,
					at: new Date(),
				},
			})
		}
		const leads = await tx.warehouseAssignment.findMany({
			where: { warehouseId: args.warehouseId, isLead: true },
			select: { userId: true },
		})
		const admins = await tx.user.findMany({
			where: { role: "ADMIN" },
			select: { id: true },
		})
		const recipients = new Set([
			...leads.map((l) => l.userId),
			...admins.map((a) => a.id),
		])
		await tx.notification.createMany({
			data: [...recipients].map((userId) => ({
				userId,
				message: `Repair batch ${batch.id} sent (${args.serials.length} units).`,
			})),
		})
		return { batchId: batch.id }
	})
}

export async function voidRepairBatch(args: {
	batchId: string
	reason: string
	byUserId: string
}) {
	if (!args.reason.trim()) throw new Error("void reason required")
	await db.$transaction(async (tx) => {
		const batch = await tx.repairBatch.findUniqueOrThrow({
			where: { id: args.batchId },
		})
		if (batch.status !== "SENT") throw new Error("batch not in SENT state")
		const members = await tx.stockMovement.findMany({
			where: { refRepairBatchId: args.batchId, type: "SENT_FOR_REPAIR" },
			select: { serial: true },
		})
		for (const m of members) {
			const serial = m.serial
			if (!serial) continue
			const back = await tx.serialLocation.updateMany({
				where: { serial, status: "SENT_FOR_REPAIR", currentRef: args.batchId },
				data: {
					status: "AWAITING_REPAIR",
					currentRef: batch.warehouseId,
					since: new Date(),
				},
			})
			if (back.count !== 1)
				throw new Error(`serial ${serial}: already back from repair`)
			const sl = await tx.serialLocation.findUniqueOrThrow({
				where: { serial },
				select: { serviceCodeId: true },
			})
			await tx.stockMovement.create({
				data: {
					kind: "SERIAL",
					type: "DISPOSITION",
					serial,
					qty: 0,
					serviceCodeId: sl.serviceCodeId,
					warehouseId: batch.warehouseId,
					refRepairBatchId: args.batchId,
					byUserId: args.byUserId,
					at: new Date(),
					note: `batch void: ${args.reason}`,
				},
			})
		}
		await tx.repairBatch.update({
			where: { id: args.batchId },
			data: {
				status: "VOIDED",
				voidedById: args.byUserId,
				voidedAt: new Date(),
				voidReason: args.reason,
			},
		})
		const leads = await tx.warehouseAssignment.findMany({
			where: { warehouseId: batch.warehouseId, isLead: true },
			select: { userId: true },
		})
		const admins = await tx.user.findMany({
			where: { role: "ADMIN" },
			select: { id: true },
		})
		await tx.notification.createMany({
			data: [
				...new Set([...leads.map((l) => l.userId), ...admins.map((a) => a.id)]),
			].map((userId) => ({
				userId,
				message: `Repair batch ${args.batchId} voided.`,
			})),
		})
	})
}

export async function correctTriage(args: {
	serial: string
	reason: string
	byUserId: string
	warehouseId: string
}) {
	if (!args.reason.trim()) throw new Error("correction reason required")
	await db.$transaction(async (tx) => {
		const moved = await tx.serialLocation.updateMany({
			where: { serial: args.serial, status: "AWAITING_REPAIR" },
			data: {
				status: "WAREHOUSE",
				currentRef: args.warehouseId,
				since: new Date(),
			},
		})
		if (moved.count !== 1)
			throw new Error(`serial ${args.serial}: expected status AWAITING_REPAIR`)
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
				note: `triage correction: ${args.reason}`,
			},
		})
	})
}

export async function generateRepairBatchDocument(batchId: string) {
	const bytes = await generateRepairBatchPdf(batchId)
	const dir = join(
		process.env.UPLOAD_DIR ?? "/tmp/jaf/uploads",
		"repair-batches",
	)
	await mkdir(dir, { recursive: true })
	const documentPath = join(dir, `${batchId}.pdf`)
	await writeFile(documentPath, bytes)
	await db.repairBatch.update({
		where: { id: batchId },
		data: { documentPath },
	})
	return { documentPath }
}
