import type { StageRow } from "~/components/finance-stage-table"
import { isAvisoSaved } from "~/lib/aviso-document"
import {
	payeeCode,
	resolveContractorAccounts,
} from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
import { type ArmAListStage, stageWhere } from "~/lib/finance-stages.server"
import { rowAmounts } from "~/lib/pbcc-batch.server"
import { evaluateReleaseGate } from "~/lib/release-gate"
import type { Prisma } from "../../generated/prisma/client"

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
	/** Step 4: add `accountResolved` to each row and return
	 * the ids of every stage job (all pages) whose contractor account resolves.
	 * One `resolveContractorAccounts` call covers the whole stage. */
	withAccounts?: boolean
	/** Work order or Aviso number, matched anywhere in the number. */
	search?: string
	supervisorId?: string
}): Promise<{ rows: StageRow[]; totalCount: number; sweepableIds: string[] }> {
	const search = opts.search?.trim()
	const where: Prisma.JafInvoiceWhereInput = {
		...stageWhere(opts.stage),
		...(opts.supervisorId && { supervisorId: opts.supervisorId }),
		...(search && {
			OR: [
				{ controlNumber: { contains: search, mode: "insensitive" } },
				{ avisoNumber: { contains: search, mode: "insensitive" } },
			],
		}),
	}
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
				jafInvoicePdfPath: true,
				avisoDocPath: true,
				releasedToFinanceAt: true,
				pbccRequestSentAt: true,
				jafInvoiceLines: true,
				jafInvoiceLineTotal: true,
				contractorAccountCode: true,
				preCertSheets: {
					orderBy: { version: "desc" },
					take: 1,
					select: {
						sigSubcontractorName: true,
						sigSupervisorAt: true,
						sigSubcontractorAt: true,
					},
				},
				photos: { select: { tag: true } },
				brigade: { select: { leadName: true, name: true, code: true } },
				supervisor: { select: { name: true } },
			},
		}),
	])
	let resolved: Map<string, unknown> | null = null
	let sweepableIds: string[] = []
	if (opts.withAccounts) {
		const all = await db.jafInvoice.findMany({
			where,
			select: {
				id: true,
				contractorAccountCode: true,
				brigade: { select: { code: true } },
			},
		})
		resolved = await resolveContractorAccounts(all.map(payeeCode))
		sweepableIds = all
			.filter((d) => {
				const code = payeeCode(d)
				return code && resolved?.has(code)
			})
			.map((d) => d.id)
	}
	const now = new Date()
	const rows: StageRow[] = docs.map((d) => {
		// The packet's four documents, read the way the release gate reads them.
		const gate = evaluateReleaseGate({
			doc: d,
			sheet: d.preCertSheets[0] ?? null,
			photos: d.photos,
		})
		const has = (key: string) =>
			gate.rows.find((r) => r.key === key)?.ok === true
		return {
			id: d.id,
			controlNumber: d.controlNumber,
			avisoNumber: d.avisoNumber,
			brigadeCode: d.brigade?.code ?? null,
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
				jafInvoice: has("work_order_pdf"),
				aviso: isAvisoSaved(d),
				preCert: has("precert_signed"),
				photos: has("photos"),
			},
			supervisorName: d.supervisor?.name ?? null,
			// Every list shows what the invoice bills: the same figures the PBCC
			// batch row carries, read from one place (`rowAmounts`). Packets show the
			// total with IVU; the payroll list shows the pre-IVU subtotal the batch
			// row bills.
			amount:
				opts.stage === "LISTS" ? rowAmounts(d).subtotal : rowAmounts(d).total,
			...(resolved && {
				accountResolved: payeeCode(d)
					? resolved.has(payeeCode(d) as string)
					: false,
			}),
		}
	})
	return { rows, totalCount, sweepableIds }
}
