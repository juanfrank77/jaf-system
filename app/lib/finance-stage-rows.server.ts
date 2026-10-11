import type { StageRow } from "~/components/finance-stage-table"
import {
	computeContractorPayment,
	resolveContractorAccounts,
	toContractorPaymentLines,
} from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
import { PAGE_SIZE } from "~/lib/finance-stage-paging"
import { type ArmAListStage, stageWhere } from "~/lib/finance-stages.server"

/** Whole days elapsed since `from` (0 when unset). */
export function ageDays(from: Date | null, now: Date = new Date()): number {
	if (!from) return 0
	return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 86_400_000))
}

/** One select + mapping shared by steps 1-3, oldest release first. */
export async function loadStageRows(opts: {
	stage: ArmAListStage
	page: number
	pageSize: number
	ageFrom: "released" | "sent"
	/** Step 4: add `accountResolved` / `missingClaroPdf` to each row and return
	 * the ids of every stage job (all pages) whose contractor account resolves.
	 * One `resolveContractorAccounts` call covers the whole stage. */
	withAccounts?: boolean
}): Promise<{ rows: StageRow[]; totalCount: number; sweepableIds: string[] }> {
	const where = stageWhere(opts.stage)
	const [totalCount, docs] = await Promise.all([
		db.jafInvoice.count({ where }),
		db.jafInvoice.findMany({
			where,
			orderBy: [{ releasedToFinanceAt: "asc" }, { id: "asc" }],
			skip: (opts.page - 1) * opts.pageSize,
			take: opts.pageSize,
			select: {
				id: true,
				controlNumber: true,
				avisoNumber: true,
				claroPdfPath: true,
				jafInvoicePdfPath: true,
				avisoMatchedAt: true,
				releasedToFinanceAt: true,
				pbccRequestSentAt: true,
				jafInvoiceLines: true,
				contractorAccountCode: true,
				preCertSheets: {
					orderBy: { version: "desc" },
					take: 1,
					select: { sigSubcontractorName: true },
				},
				brigade: { select: { leadName: true, name: true } },
			},
		}),
	])
	let resolved: Map<string, unknown> | null = null
	let sweepableIds: string[] = []
	if (opts.withAccounts) {
		const all = await db.jafInvoice.findMany({
			where,
			select: { id: true, contractorAccountCode: true },
		})
		resolved = await resolveContractorAccounts(
			all.map((d) => d.contractorAccountCode),
		)
		sweepableIds = all
			.filter(
				(d) =>
					d.contractorAccountCode && resolved?.has(d.contractorAccountCode),
			)
			.map((d) => d.id)
	}
	const now = new Date()
	const rows: StageRow[] = docs.map((d) => ({
		id: d.id,
		controlNumber: d.controlNumber,
		avisoNumber: d.avisoNumber,
		contractorLabel:
			d.preCertSheets[0]?.sigSubcontractorName ??
			d.brigade?.leadName ??
			d.brigade?.name ??
			null,
		ageDays: ageDays(
			opts.ageFrom === "sent" ? d.pbccRequestSentAt : d.releasedToFinanceAt,
			now,
		),
		docs: {
			claroPdf: Boolean(d.claroPdfPath?.trim()),
			jafInvoice: Boolean(d.jafInvoicePdfPath),
			aviso: Boolean(d.avisoNumber && d.avisoMatchedAt),
		},
		amount: computeContractorPayment(
			toContractorPaymentLines(d.jafInvoiceLines),
		).grossPayable,
		...(resolved && {
			accountResolved: d.contractorAccountCode
				? resolved.has(d.contractorAccountCode)
				: false,
			missingClaroPdf: !d.claroPdfPath || d.claroPdfPath.trim() === "",
		}),
	}))
	return { rows, totalCount, sweepableIds }
}
