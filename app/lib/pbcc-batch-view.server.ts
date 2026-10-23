import { bankInvoiceNumber } from "~/lib/bank-schedule"
import { db } from "~/lib/db.server"
import { PBCC_BATCH_CAPACITY } from "~/lib/finance-home"
import { BATCH_ROW_ORDER, rowAmounts } from "~/lib/pbcc-batch.server"
import {
	type BatchStatus,
	type BatchSummary,
	type BatchView,
	batchStatus,
} from "~/lib/pbcc-batch-view"
import { getBankInvoicePrefix } from "~/lib/system-settings.server"

/** One batch with its rows, as the open-batch and batch screens show it. */
export async function loadBatchView(
	batchId: string,
): Promise<BatchView | null> {
	const [batch, docs, prefix] = await Promise.all([
		db.bankSchedule.findUnique({ where: { id: batchId } }),
		db.jafInvoice.findMany({
			where: { bankScheduleId: batchId },
			orderBy: BATCH_ROW_ORDER,
			include: { brigade: { select: { name: true, leadName: true } } },
		}),
		getBankInvoicePrefix(),
	])
	if (!batch) return null
	return {
		id: batch.id,
		number: batch.number,
		status: batchStatus(batch),
		closedAt: batch.closedAt?.toISOString() ?? null,
		sentAt: batch.sentAt?.toISOString() ?? null,
		count: docs.length,
		capacity: PBCC_BATCH_CAPACITY,
		subtotal: Number(batch.total),
		advanceRate: Number(batch.advanceRate),
		advance: Number(batch.advanceAmount),
		hasExcel: Boolean(batch.xlsxPath),
		rows: docs.map((doc, i) => {
			const amounts = rowAmounts(doc)
			return {
				id: doc.id,
				row: i + 1,
				controlNumber: doc.controlNumber,
				avisoNumber: doc.avisoNumber,
				brigade: doc.brigade?.leadName ?? doc.brigade?.name ?? null,
				invoiceNumber: bankInvoiceNumber(
					prefix,
					doc.avisoNumber || doc.controlNumber,
				),
				subtotal: amounts.subtotal,
				ivu: amounts.ivu,
				total: amounts.total,
				hasAvisoPdf: Boolean(doc.avisoDocPath),
				hasInvoicePdf: Boolean(doc.bankInvoicePdfPath),
			}
		}),
	}
}

/** Closed and sent batches, newest first, for the Sent tab. */
export async function listBatches(
	status: Exclude<BatchStatus, "open">[] = ["closed", "sent"],
	take = 50,
): Promise<BatchSummary[]> {
	const batches = await db.bankSchedule.findMany({
		where: { closedAt: { not: null } },
		orderBy: { number: "desc" },
		take,
		include: { _count: { select: { invoices: true } } },
	})
	return batches
		.map((b) => ({
			id: b.id,
			number: b.number,
			status: batchStatus(b),
			closedAt: b.closedAt?.toISOString() ?? null,
			sentAt: b.sentAt?.toISOString() ?? null,
			count: b._count.invoices,
			subtotal: Number(b.total),
		}))
		.filter((b) => status.includes(b.status as never))
}
