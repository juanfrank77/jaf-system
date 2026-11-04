import type { StageRow } from "~/components/finance-stage-table"
import { isAvisoSaved } from "~/lib/aviso-document"
import {
	computeContractorPayment,
	resolveContractorAccounts,
	toContractorPaymentLines,
} from "~/lib/contractor-payment.server"
import { db } from "~/lib/db.server"
import {
	type ArmAListStage,
	financeSendBackIds,
	stageWhere,
} from "~/lib/finance-stages.server"
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
	/** Step 1 only (S4): "all" leaves the packets Finance sent back out and
	 * lists a resent one first; "only" is the Returned list. */
	view?: "all" | "returned"
}): Promise<{ rows: StageRow[]; totalCount: number; sweepableIds: string[] }> {
	const packets = opts.stage === "PACKETS"
	const sent = packets
		? await financeSendBackIds()
		: { returned: [], resent: [] as string[] }
	const returnedView = packets && opts.view === "returned"
	const where: Prisma.JafInvoiceWhereInput = returnedView
		? {
				...stageWhere(opts.stage),
				id: { in: sent.returned },
			}
		: stageWhere(opts.stage, sent.returned)
	const orderBy: Prisma.JafInvoiceOrderByWithRelationInput[] = [
		{ releasedToFinanceAt: "asc" },
		{ id: "asc" },
	]
	// A resent packet goes to the top of the list so she looks at it first.
	// The page is cut from the ordered ids, then its rows are read.
	let pageIds: string[] | null = null
	if (!returnedView && sent.resent.length > 0) {
		const ordered = await db.jafInvoice.findMany({
			where,
			orderBy,
			select: { id: true },
		})
		const ids = ordered.map((d) => d.id)
		const present = new Set(ids)
		const resentFirst = sent.resent.filter((id) => present.has(id))
		const resentSet = new Set(resentFirst)
		pageIds = [...resentFirst, ...ids.filter((id) => !resentSet.has(id))].slice(
			(opts.page - 1) * opts.pageSize,
			opts.page * opts.pageSize,
		)
	}
	const [totalCount, found] = await Promise.all([
		db.jafInvoice.count({ where }),
		db.jafInvoice.findMany({
			where: pageIds ? { AND: [where, { id: { in: pageIds } }] } : where,
			orderBy,
			...(pageIds
				? {}
				: {
						skip: (opts.page - 1) * opts.pageSize,
						take: opts.pageSize,
					}),
			select: {
				id: true,
				controlNumber: true,
				avisoNumber: true,
				jafInvoicePdfPath: true,
				avisoDocPath: true,
				releasedToFinanceAt: true,
				financeVerifiedAt: true,
				pbccRequestSentAt: true,
				jafInvoiceLines: true,
				contractorAccountCode: true,
				// Every current certificate (one per crew), lead first.
				preCertSheets: {
					where: { supersededAt: null },
					orderBy: { version: "asc" },
					select: {
						sigSubcontractorName: true,
						sigSupervisorAt: true,
						sigSubcontractorAt: true,
						// The gate counts a signed sheet only for the current Aviso.
						avisoNumber: true,
					},
				},
				photos: { select: { tag: true } },
				brigade: { select: { leadName: true, name: true } },
			},
		}),
	])
	const docs = pageIds
		? pageIds.flatMap((id) => found.filter((d) => d.id === id))
		: found
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
	const rows: StageRow[] = docs.map((d) => {
		// The packet's four documents, read the way the release gate reads them.
		const gate = evaluateReleaseGate({
			doc: d,
			sheet: d.preCertSheets,
			photos: d.photos,
		})
		const has = (key: string) =>
			gate.rows.find((r) => r.key === key)?.ok === true
		return {
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
				jafInvoice: has("work_order_pdf"),
				aviso: isAvisoSaved(d),
				preCert: has("precert_signed"),
				photos: has("photos"),
				account: Boolean(d.contractorAccountCode),
			},
			amount: computeContractorPayment(
				toContractorPaymentLines(d.jafInvoiceLines),
			).grossPayable,
			...(packets && {
				resent: sent.resent.includes(d.id) && !d.financeVerifiedAt,
				returned: returnedView,
			}),
			...(resolved && {
				accountResolved: d.contractorAccountCode
					? resolved.has(d.contractorAccountCode)
					: false,
			}),
		}
	})
	return { rows, totalCount, sweepableIds }
}
