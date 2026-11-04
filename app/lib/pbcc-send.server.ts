import { db } from "~/lib/db.server"
import { sendPacketEmail } from "~/lib/packet-mail.server"
import { checkBatch, markBatchSent } from "~/lib/pbcc-batch.server"
import { buildPackagePart, planPackage } from "~/lib/pbcc-package.server"
import { getPbccEmail } from "~/lib/system-settings.server"
import type { Prisma } from "../../generated/prisma/client"

export type PbccEmailEntry = {
	part: number
	of: number
	to: string
	outcome: "SENT" | "FAILED" | "UNCONFIGURED"
	error?: string
	at: string
	byId: string
}

export type PbccSendResult =
	| { ok: true; parts: number }
	| {
			ok: false
			errorKey:
				| "pbcc_batch.errors.no_pbcc_email"
				| "pbcc_batch.errors.email_not_set_up"
				| "pbcc_batch.errors.email_failed"
				| "pbcc_batch.errors.not_closed"
				| "pbcc_batch.errors.check_failed"
	  }

/**
 * Sends a closed, green batch to PBCC: its invoices, Avisos and Excel, split into
 * the same parts as the download. Every attempt is logged on the batch. It is
 * marked Sent only when every part went; a failed send changes nothing else, and
 * Download with Mark sent stays the way around it.
 */
export async function sendBatchToPbcc(opts: {
	batchId: string
	sentById: string
}): Promise<PbccSendResult> {
	const batch = await db.bankSchedule.findUnique({
		where: { id: opts.batchId },
		select: { closedAt: true, sentAt: true, emailLog: true },
	})
	if (!batch?.closedAt || batch.sentAt)
		return { ok: false, errorKey: "pbcc_batch.errors.not_closed" }
	if (!(await checkBatch(opts.batchId)).passed)
		return { ok: false, errorKey: "pbcc_batch.errors.check_failed" }
	const to = await getPbccEmail()
	if (!to) return { ok: false, errorKey: "pbcc_batch.errors.no_pbcc_email" }

	const plan = await planPackage(opts.batchId)
	const log: PbccEmailEntry[] = Array.isArray(batch.emailLog)
		? (batch.emailLog as unknown as PbccEmailEntry[])
		: []
	let failed: "UNCONFIGURED" | "FAILED" | null = null
	for (const p of plan) {
		const built = await buildPackagePart(opts.batchId, p.part)
		if (!built) {
			failed = "FAILED"
			break
		}
		const result = await sendPacketEmail({
			to,
			subject: p.subject,
			text: p.subject,
			attachments: [{ filename: built.filename, content: built.zip }],
		})
		log.push({
			part: p.part,
			of: p.of,
			to,
			outcome: result.outcome,
			...(result.error ? { error: result.error } : {}),
			at: new Date().toISOString(),
			byId: opts.sentById,
		})
		if (result.outcome !== "SENT") {
			failed = result.outcome
			break
		}
	}
	await db.bankSchedule.update({
		where: { id: opts.batchId },
		data: { emailLog: log as unknown as Prisma.InputJsonValue },
	})
	if (failed === "UNCONFIGURED")
		return { ok: false, errorKey: "pbcc_batch.errors.email_not_set_up" }
	if (failed) return { ok: false, errorKey: "pbcc_batch.errors.email_failed" }
	await markBatchSent({ batchId: opts.batchId, sentById: opts.sentById })
	return { ok: true, parts: plan.length }
}
