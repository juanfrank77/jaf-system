import fs from "node:fs/promises"
import {
	areaLetter,
	bankInvoiceNumber,
	contractLabel,
	jobKind,
	localityFromAddress,
	scheduleTotals,
} from "~/lib/bank-schedule"
import {
	generateScheduleXlsx,
	type ScheduleRow,
} from "~/lib/bank-schedule-xlsx.server"
import { db } from "~/lib/db.server"
import { stageWhere } from "~/lib/finance-stages.server"
import {
	type BankInvoiceLine,
	generateBankInvoicePdf,
} from "~/lib/pdf/bank-invoice.server"
import type { InvoiceLine } from "~/lib/service-lines"
import {
	getBankInvoicePrefix,
	getLcPbccAdvanceRate,
} from "~/lib/system-settings.server"
import { saveBuffer } from "~/lib/uploads.server"
import { toNumberPrice } from "~/lib/utils"

export type ScheduleErrorCode =
	| "empty"
	| "not_found"
	| "not_eligible"
	| "already_scheduled"
	| "no_area"
	| "incomplete"

export class ScheduleValidationError extends Error {
	constructor(
		public code: ScheduleErrorCode,
		public controlNumbers: string[] = [],
	) {
		super(`Bank schedule refused: ${code}`)
		this.name = "ScheduleValidationError"
	}
}

const SUPPLIER_NUMBER = "V0000000006"
const DEBTOR = "PRT / CLARO"

/** MM/DD/YY of the Puerto Rico business-calendar day containing `d`. */
export function bankDateLabel(d: Date): string {
	return d.toLocaleDateString("en-US", {
		month: "2-digit",
		day: "2-digit",
		year: "2-digit",
		timeZone: "America/Puerto_Rico",
	})
}

export async function buildBankSchedule(opts: {
	packetIds: string[]
	generatedById: string
}): Promise<{ scheduleId: string }> {
	const ids = [...new Set(opts.packetIds)]
	if (ids.length === 0) throw new ScheduleValidationError("empty")

	const docs = await db.jafInvoice.findMany({
		where: { id: { in: ids } },
		include: { brigade: { select: { area: true } } },
	})
	if (docs.length !== ids.length) throw new ScheduleValidationError("not_found")

	const eligible = new Set(
		(
			await db.jafInvoice.findMany({
				where: { AND: [{ id: { in: ids } }, stageWhere("LC_REQUEST")] },
				select: { id: true },
			})
		).map((d) => d.id),
	)
	const notEligible = docs.filter((d) => !eligible.has(d.id))
	if (notEligible.length > 0)
		throw new ScheduleValidationError(
			notEligible.some((d) => d.bankScheduleId)
				? "already_scheduled"
				: "not_eligible",
			notEligible.map((d) => d.controlNumber),
		)
	const scheduled = docs.filter((d) => d.bankScheduleId)
	if (scheduled.length > 0)
		throw new ScheduleValidationError(
			"already_scheduled",
			scheduled.map((d) => d.controlNumber),
		)
	const noArea = docs.filter((d) => !areaLetter(d.brigade?.area))
	if (noArea.length > 0)
		throw new ScheduleValidationError(
			"no_area",
			noArea.map((d) => d.controlNumber),
		)

	const [prefix, rate] = await Promise.all([
		getBankInvoicePrefix(),
		getLcPbccAdvanceRate(),
	])
	const amounts = docs.map((d) => toNumberPrice(d.jafInvoiceLineTotal))
	const { total, advance } = scheduleTotals(amounts, rate)

	// Claim: create the schedule and take the packets in one transaction. The
	// conditional updateMany (still LC_REQUEST-eligible and unscheduled) is what
	// makes the claim race-safe: a concurrent build, send-back or cancel between
	// the pre-check and here leaves the count short and the whole thing rolls back.
	const schedule = await db.$transaction(async (tx) => {
		const created = await tx.bankSchedule.create({
			data: {
				generatedById: opts.generatedById,
				advanceRate: rate,
				total,
				advanceAmount: advance,
			},
		})
		const claimed = await tx.jafInvoice.updateMany({
			where: {
				AND: [
					{ id: { in: ids } },
					stageWhere("LC_REQUEST"),
					{ bankScheduleId: null },
				],
			},
			data: { bankScheduleId: created.id },
		})
		if (claimed.count !== ids.length) {
			const missed = await tx.jafInvoice.findMany({
				where: {
					id: { in: ids },
					OR: [
						{ bankScheduleId: null },
						{ bankScheduleId: { not: created.id } },
					],
				},
				select: { controlNumber: true, bankScheduleId: true },
			})
			throw new ScheduleValidationError(
				missed.some((d) => d.bankScheduleId)
					? "already_scheduled"
					: "not_eligible",
				missed.map((d) => d.controlNumber),
			)
		}
		return created
	})

	const written: string[] = []
	try {
		const catalog = await db.serviceCode.findMany()
		const byId = new Map(catalog.map((c) => [c.id, c]))
		const rows: ScheduleRow[] = []
		for (const doc of docs) {
			const lines = ((doc.jafInvoiceLines as InvoiceLine[] | null) ?? []).map(
				(l): BankInvoiceLine => {
					const c = byId.get(l.serviceCodeId)
					return {
						claroCode: l.claroCode,
						description: l.name,
						qty: l.qty,
						unit: l.unit ?? "EA",
						unitPrice: l.unitPrice,
						amount: l.lineAmount,
						accountCode: c?.accountCode ?? l.accountCode ?? "",
						subAct: c?.subAct ?? "",
						dept: c?.dept ?? "",
						profitCenter: c?.profitCenter ?? "",
						act: c?.act ?? "",
						costCenter: c?.costCenterCode ?? "",
					}
				},
			)
			const aviso = doc.avisoNumber ?? doc.controlNumber
			const invoiceNumber = bankInvoiceNumber(prefix, aviso)
			const from = doc.startedAt ?? doc.fieldSubmittedAt ?? doc.createdAt
			const to = doc.endedAt ?? from
			const pdf = await generateBankInvoicePdf({
				supplierNumber: SUPPLIER_NUMBER,
				invoiceNumber,
				contractLabel: contractLabel(prefix),
				workFrom: bankDateLabel(from),
				workTo: bankDateLabel(to),
				description: doc.jobDescription ?? doc.jobType,
				locality: localityFromAddress(
					doc.jobAddressActual ?? doc.jobAddressEstimated,
				),
				kind: jobKind(doc.jobType),
				lines,
				total: toNumberPrice(doc.jafInvoiceLineTotal),
			})
			const pdfPath = await saveBuffer(
				"bank-invoices",
				`${doc.id}-bank-invoice.pdf`,
				pdf,
			)
			written.push(pdfPath)
			await db.jafInvoice.update({
				where: { id: doc.id },
				data: { bankInvoicePdfPath: pdfPath },
			})
			rows.push({
				// An instant: the generator prints it in the Puerto Rico calendar.
				invoiceDate: from,
				invoiceNumber,
				area: areaLetter(doc.brigade?.area) as string,
				debtor: DEBTOR,
				po: "",
				amount: toNumberPrice(doc.jafInvoiceLineTotal),
			})
		}
		const xlsx = await generateScheduleXlsx({
			rows,
			total,
			advance,
			date: new Date(),
			seller: "JAF COM",
		})
		const xlsxPath = await saveBuffer(
			"bank-schedules",
			`schedule-${schedule.number}.xlsx`,
			xlsx,
		)
		written.push(xlsxPath)
		await db.bankSchedule.update({
			where: { id: schedule.id },
			data: { xlsxPath },
		})
	} catch (e) {
		// Drop this build's files first, while the packets are still claimed, so
		// a concurrent build cannot have rewritten a same-named PDF yet. Then
		// release the claim so the packets return to the LC request list.
		// Cleanup is best effort: the ORIGINAL error is always what surfaces; a
		// schedule left half-built can be removed with discardBankSchedule.
		await unlinkQuietly(written)
		try {
			await db.$transaction([
				db.jafInvoice.updateMany({
					where: { bankScheduleId: schedule.id },
					data: { bankScheduleId: null, bankInvoicePdfPath: null },
				}),
				db.bankSchedule.delete({ where: { id: schedule.id } }),
			])
		} catch (cleanupError) {
			// biome-ignore lint/suspicious/noConsole: cleanup failure must not mask the build error
			console.error(
				`Bank schedule ${schedule.id}: failed to release claim after a build error`,
				cleanupError,
			)
		}
		throw e
	}
	return { scheduleId: schedule.id }
}

export async function markScheduleSent(opts: {
	scheduleId: string
	sentById: string
}): Promise<{ alreadySent: boolean }> {
	const comptrollers = await db.user.findMany({
		where: { role: "COMPTROLLER", active: true },
		select: { id: true },
	})
	return db.$transaction(async (tx) => {
		// Every packet not yet sent must still be LC_REQUEST-eligible: one sent
		// back or cancelled after scheduling must not be stamped as sent.
		const packets = await tx.jafInvoice.findMany({
			where: { bankScheduleId: opts.scheduleId },
			select: { id: true, controlNumber: true, pbccRequestSentAt: true },
		})
		const unsent = packets.filter((p) => !p.pbccRequestSentAt)
		const eligible = new Set(
			(
				await tx.jafInvoice.findMany({
					where: {
						AND: [
							{ id: { in: unsent.map((p) => p.id) } },
							stageWhere("LC_REQUEST"),
						],
					},
					select: { id: true },
				})
			).map((p) => p.id),
		)
		const offenders = unsent.filter((p) => !eligible.has(p.id))
		if (offenders.length > 0)
			throw new ScheduleValidationError(
				"not_eligible",
				offenders.map((p) => p.controlNumber),
			)

		// Only a complete (xlsx written), unsent schedule can be marked sent.
		const claimed = await tx.bankSchedule.updateMany({
			where: { id: opts.scheduleId, sentAt: null, xlsxPath: { not: null } },
			data: { sentAt: new Date(), sentById: opts.sentById },
		})
		if (claimed.count === 0) {
			const existing = await tx.bankSchedule.findUnique({
				where: { id: opts.scheduleId },
				select: { sentAt: true },
			})
			if (!existing) throw new ScheduleValidationError("not_found", [])
			if (existing.sentAt) return { alreadySent: true }
			throw new ScheduleValidationError("incomplete", [])
		}
		const now = new Date()
		await tx.jafInvoice.updateMany({
			where: { bankScheduleId: opts.scheduleId, pbccRequestSentAt: null },
			data: { pbccRequestSentAt: now, karmenCopySentAt: now },
		})
		await tx.auditTrail.createMany({
			data: packets.map((p) => ({
				docId: p.id,
				userId: opts.sentById,
				action: "PBCC_REQUEST_GENERATED" as const,
				diffJson: { scheduleId: opts.scheduleId },
			})),
		})
		const schedule = await tx.bankSchedule.findUniqueOrThrow({
			where: { id: opts.scheduleId },
		})
		await tx.notification.createMany({
			data: comptrollers.map((c) => ({
				userId: c.id,
				message: `Bank schedule #${schedule.number} sent to PBCC (${packets.length} packets).`,
			})),
		})
		return { alreadySent: false }
	})
}

/**
 * Remove an unsent schedule and return its packets to the LC request list:
 * recovery for a build that crashed or failed to clean up, and for a packet
 * sent back or cancelled after scheduling. A sent schedule is left untouched.
 */
export async function discardBankSchedule(opts: {
	scheduleId: string
}): Promise<{ discarded: boolean }> {
	const files = await db.$transaction(async (tx) => {
		// Lock the row (no-op update) so a concurrent markScheduleSent waits.
		const locked = await tx.bankSchedule.updateMany({
			where: { id: opts.scheduleId, sentAt: null },
			data: { sentAt: null },
		})
		if (locked.count === 0) {
			const existing = await tx.bankSchedule.findUnique({
				where: { id: opts.scheduleId },
				select: { id: true },
			})
			if (!existing) throw new ScheduleValidationError("not_found", [])
			return null
		}
		const schedule = await tx.bankSchedule.findUniqueOrThrow({
			where: { id: opts.scheduleId },
			select: { xlsxPath: true },
		})
		const packets = await tx.jafInvoice.findMany({
			where: { bankScheduleId: opts.scheduleId },
			select: { bankInvoicePdfPath: true },
		})
		await tx.jafInvoice.updateMany({
			where: { bankScheduleId: opts.scheduleId },
			data: { bankScheduleId: null, bankInvoicePdfPath: null },
		})
		await tx.bankSchedule.delete({ where: { id: opts.scheduleId } })
		return [schedule.xlsxPath, ...packets.map((p) => p.bankInvoicePdfPath)]
	})
	if (!files) return { discarded: false }
	await unlinkQuietly(files.filter((f): f is string => !!f))
	return { discarded: true }
}

/** Best-effort file removal: failures are logged, never thrown. */
async function unlinkQuietly(paths: string[]): Promise<void> {
	await Promise.all(
		paths.map((p) =>
			fs.unlink(p).catch((err) => {
				if ((err as NodeJS.ErrnoException).code !== "ENOENT")
					// biome-ignore lint/suspicious/noConsole: best-effort unlink, never thrown
					console.error(`Failed to remove ${p}`, err)
			}),
		),
	)
}
