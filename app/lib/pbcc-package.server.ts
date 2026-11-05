import fs from "node:fs/promises"
import { BANK_INVOICE_PREFIX, bankInvoiceNumber } from "~/lib/bank-schedule"
import { db } from "~/lib/db.server"
import { zipPackage } from "~/lib/package-zip.server"
import { BATCH_ROW_ORDER, BatchError } from "~/lib/pbcc-batch.server"

/** No emailed part goes over this (zip headers and the email itself included). */
const PACKAGE_PART_LIMIT = 20 * 1024 * 1024
/** Slack kept under the limit for zip headers. */
const PER_FILE_OVERHEAD = 1024

type PackageFile = { name: string; path: string; bytes: number }

type PackagePartPlan = {
	part: number
	of: number
	/** 1-based row numbers this part carries. */
	rowFrom: number
	rowTo: number
	bytes: number
	hasExcel: boolean
	subject: string
	files: PackageFile[]
}

const rowLabel = (n: number) => String(n).padStart(3, "0")

const sizeOf = (p: string) =>
	fs.stat(p).then(
		(s) => s.size,
		() => 0,
	)

/**
 * The batch's package for the PBCC email: the Excel (whole batch) in part 1,
 * then each row's Aviso and invoice PDF named by its row number, split so every
 * part stays under 20 MB. A row is never split across parts.
 */
export async function planPackage(
	batchId: string,
	limit: number = PACKAGE_PART_LIMIT,
): Promise<PackagePartPlan[]> {
	const [batch, docs] = await Promise.all([
		db.bankSchedule.findUnique({ where: { id: batchId } }),
		db.jafInvoice.findMany({
			where: { bankScheduleId: batchId },
			orderBy: BATCH_ROW_ORDER,
			select: {
				controlNumber: true,
				avisoNumber: true,
				avisoDocPath: true,
				bankInvoicePdfPath: true,
			},
		}),
	])
	if (!batch) throw new BatchError("not_found")
	if (!batch.closedAt || !batch.xlsxPath) throw new BatchError("not_closed")

	const excel: PackageFile = {
		name: `PBCC_Batch_${batch.number}.xlsx`,
		path: batch.xlsxPath,
		bytes: await sizeOf(batch.xlsxPath),
	}
	const rows: { n: number; files: PackageFile[] }[] = []
	for (const [i, doc] of docs.entries()) {
		const n = i + 1
		const aviso = doc.avisoNumber || doc.controlNumber
		const files: PackageFile[] = []
		if (doc.avisoDocPath)
			files.push({
				name: `${rowLabel(n)}_Aviso_${aviso}.pdf`,
				path: doc.avisoDocPath,
				bytes: await sizeOf(doc.avisoDocPath),
			})
		if (doc.bankInvoicePdfPath)
			files.push({
				name: `${rowLabel(n)}_Inv_${bankInvoiceNumber(BANK_INVOICE_PREFIX, aviso)}.pdf`,
				path: doc.bankInvoicePdfPath,
				bytes: await sizeOf(doc.bankInvoicePdfPath),
			})
		rows.push({ n, files })
	}

	const groups: { rows: typeof rows; bytes: number }[] = [
		{ rows: [], bytes: excel.bytes + PER_FILE_OVERHEAD },
	]
	for (const row of rows) {
		const bytes = row.files.reduce((s, f) => s + f.bytes + PER_FILE_OVERHEAD, 0)
		const current = groups[groups.length - 1]
		if (current.rows.length > 0 && current.bytes + bytes > limit)
			groups.push({ rows: [], bytes: 0 })
		const target = groups[groups.length - 1]
		target.rows.push(row)
		target.bytes += bytes
	}
	return groups.map((g, i) => ({
		part: i + 1,
		of: groups.length,
		rowFrom: g.rows[0]?.n ?? 0,
		rowTo: g.rows.at(-1)?.n ?? 0,
		bytes: g.bytes,
		hasExcel: i === 0,
		subject: `JAF — PBCC Batch #${batch.number} — Part ${i + 1} of ${groups.length}`,
		files: [...(i === 0 ? [excel] : []), ...g.rows.flatMap((r) => r.files)],
	}))
}

/** One part of the package as a zip, byte for byte as stored. */
export async function buildPackagePart(
	batchId: string,
	part: number,
): Promise<{ zip: Buffer; filename: string } | null> {
	const plan = await planPackage(batchId)
	const wanted = plan.find((p) => p.part === part)
	if (!wanted) return null
	const batch = await db.bankSchedule.findUniqueOrThrow({
		where: { id: batchId },
		select: { number: true },
	})
	return {
		zip: await zipPackage(wanted.files),
		filename: `PBCC_Batch_${batch.number}_Part_${wanted.part}_of_${wanted.of}.zip`,
	}
}
