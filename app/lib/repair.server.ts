import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { db } from "~/lib/db.server"
import { generateRepairBatchPdf } from "~/lib/pdf/repair-batch.server"
import type { Prisma } from "../../generated/prisma/client"

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

export async function dispositionSerial(
	args: {
		serial: string
		disposition: Disposition
		reason?: string
		byUserId: string
		warehouseId: string
	},
	tx?: Prisma.TransactionClient,
) {
	const nextStatus = DISPO_TO_STATUS[args.disposition]
	const run = async (client: Prisma.TransactionClient) => {
		const updated = await client.serialLocation.updateMany({
			where: { serial: args.serial, status: "RETURNED" },
			data: {
				status: nextStatus,
				currentRef: args.warehouseId,
				since: new Date(),
			},
		})
		if (updated.count !== 1)
			throw new Error(`serial ${args.serial}: expected status RETURNED`)
		const sl = await client.serialLocation.findUniqueOrThrow({
			where: { serial: args.serial },
			select: { serviceCodeId: true },
		})
		await client.stockMovement.create({
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
	}
	// A caller composing this into its own transaction (e.g. Spec B's
	// returns-confirm, which writes a bulk RETURN movement + this disposition
	// atomically) passes `tx`; otherwise this opens its own, as before.
	const result = tx ? await run(tx) : await db.$transaction(run)
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

const LIVE_STATUSES = ["INSTALLED", "VAN"] as const

// id→id: original ServiceCode → its `reparadoCode` (a Claro code string) → the
// REPARADO ServiceCode's id. `serviceCodeId` is an FK, so an unresolved code
// must NOT invent a dangling string: keep the original id and flag `needsCode`
// (surfaced for a catalog fix).
export async function resolveReparadoServiceCodeId(
	originalServiceCodeId: string,
) {
	const original = await db.serviceCode
		.findUnique({
			where: { id: originalServiceCodeId },
			select: { reparadoCode: true },
		})
		.catch(() => null)
	if (original?.reparadoCode) {
		const reparado = await db.serviceCode
			.findUnique({
				where: { claroCode: original.reparadoCode },
				select: { id: true },
			})
			.catch(() => null)
		if (reparado) return { serviceCodeId: reparado.id, needsCode: false }
	}
	return { serviceCodeId: originalServiceCodeId, needsCode: true }
}

export async function receiveRepairedUnits(args: {
	warehouseId: string
	declaredCount: number
	scans: { serial: string; serviceCodeId: string }[]
	mismatchNote?: string
	byUserId: string
	claroReference?: string
}) {
	const scans = [...new Map(args.scans.map((s) => [s.serial, s])).values()] // dedupe
	return db.$transaction(async (tx) => {
		const intake = await tx.repairIntake.create({
			data: {
				warehouseId: args.warehouseId,
				receivedById: args.byUserId,
				receivedAt: new Date(),
				declaredCount: args.declaredCount,
				mismatchNote: args.mismatchNote,
				claroReference: args.claroReference,
			},
		})
		const flagged: string[] = []
		let stocked = 0
		for (const scan of scans) {
			const existing = await tx.serialLocation.findUnique({
				where: { serial: scan.serial },
				select: { status: true },
			})
			if (
				existing &&
				LIVE_STATUSES.includes(existing.status as "INSTALLED" | "VAN")
			) {
				flagged.push(scan.serial)
				continue
			}
			// scan.serviceCodeId is the ORIGINAL code, resolved from the physical
			// Claro scan at the route boundary.
			const { serviceCodeId: reparadoId, needsCode } =
				await resolveReparadoServiceCodeId(scan.serviceCodeId)
			if (existing) {
				// Compare-and-swap: only move it if it is still NOT live-elsewhere.
				// Guards the TOCTOU between the read above and this write (a
				// concurrent install, or a duplicate concurrent intake).
				const moved = await tx.serialLocation.updateMany({
					where: { serial: scan.serial, status: { notIn: [...LIVE_STATUSES] } },
					data: {
						status: "WAREHOUSE",
						condition: "REFURBISHED",
						serviceCodeId: reparadoId,
						currentRef: args.warehouseId,
						since: new Date(),
					},
				})
				if (moved.count !== 1) {
					flagged.push(scan.serial) // raced into a live state between read and write
					continue
				}
			} else {
				await tx.serialLocation.create({
					data: {
						serial: scan.serial,
						serviceCodeId: reparadoId,
						status: "WAREHOUSE",
						condition: "REFURBISHED",
						currentRef: args.warehouseId,
						since: new Date(),
					},
				})
			}
			if (needsCode) flagged.push(scan.serial) // stocked under original code; lead fixes catalog
			await tx.stockMovement.create({
				data: {
					kind: "SERIAL",
					type: "REPAIR_INTAKE",
					serial: scan.serial,
					qty: 0,
					serviceCodeId: reparadoId,
					warehouseId: args.warehouseId,
					refRepairIntakeId: intake.id,
					byUserId: args.byUserId,
					at: new Date(),
					note: needsCode
						? "REPARADO code unresolved — stocked under original code, needs catalog fix"
						: undefined,
				},
			})
			stocked++
		}
		// Spec §7: "scanned" = units actually stocked (REPAIR_INTAKE movements),
		// not the raw scan count — a skipped live-elsewhere unit is a real
		// mismatch that must be acknowledged with a note.
		if (args.declaredCount !== stocked && !args.mismatchNote?.trim())
			throw new Error("mismatchNote required (declared != scanned)")
		if (args.declaredCount !== stocked) {
			const leads = await tx.warehouseAssignment.findMany({
				where: { warehouseId: args.warehouseId, isLead: true },
				select: { userId: true },
			})
			await tx.notification.createMany({
				data: leads.map((l) => ({
					userId: l.userId,
					message: `Repaired intake ${intake.id}: declared ${args.declaredCount}, stocked ${stocked}.`,
				})),
			})
		}
		return { intakeId: intake.id, flagged, stocked }
	})
}

// A lead resolves a NEEDS_REVIEW hold into the repair pool (FAILED) or back to
// stock (GOOD). dispositionSerial guards RETURNED, so this is its NEEDS_REVIEW
// sibling with the same compare-and-swap + movement discipline.
export async function resolveNeedsReview(args: {
	serial: string
	decision: "FAILED" | "GOOD"
	reason?: string
	byUserId: string
	warehouseId: string
}) {
	const nextStatus =
		args.decision === "FAILED" ? "AWAITING_REPAIR" : "WAREHOUSE"
	return db.$transaction(async (tx) => {
		const moved = await tx.serialLocation.updateMany({
			where: { serial: args.serial, status: "NEEDS_REVIEW" },
			data: {
				status: nextStatus,
				currentRef: args.warehouseId,
				since: new Date(),
			},
		})
		if (moved.count !== 1)
			throw new Error(`serial ${args.serial}: expected status NEEDS_REVIEW`)
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
				note: `needs-review → ${args.decision}${args.reason ? `: ${args.reason}` : ""}`,
			},
		})
		return { status: nextStatus }
	})
}
