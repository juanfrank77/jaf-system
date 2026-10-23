import { db } from "~/lib/db.server"
import { type FinanceHome, NEXT_UP_LIMIT } from "~/lib/finance-home"
import { ageDays } from "~/lib/finance-stage-rows.server"
import {
	type ArmAListStage,
	carmenOpenSummary,
	stageWhere,
} from "~/lib/finance-stages.server"
import {
	ARM_B_STEP_HREF,
	FINANCE_STEP_HREF,
	type FinanceStep,
} from "~/lib/finance-steps"
import { rowAmounts } from "~/lib/pbcc-batch.server"

const NEXT_UP_STAGES: { stage: ArmAListStage; step: FinanceStep }[] = [
	{ stage: "PACKETS", step: "PACKETS" },
	{ stage: "LC_REQUEST", step: "LC_REQUEST" },
	{ stage: "LISTS", step: "LISTS" },
]

function itemHref(step: FinanceStep, id: string): string {
	// A packet opens its own review; every later step is a list screen.
	return step === "PACKETS" ? `/finance/verify/${id}` : FINANCE_STEP_HREF[step]
}

export async function loadFinanceHome(
	now: Date = new Date(),
): Promise<FinanceHome> {
	const [
		inboxCount,
		inboxOldest,
		openBatch,
		carmen,
		oldestRun,
		nextUpRows,
		posWaiting,
		notLoaded,
	] = await Promise.all([
		db.jafInvoice.count({ where: stageWhere("PACKETS") }),
		db.jafInvoice.findFirst({
			where: stageWhere("PACKETS"),
			orderBy: { releasedToFinanceAt: "asc" },
			select: { releasedToFinanceAt: true },
		}),
		// The open PBCC batch (rows and subtotal); until one exists, the
		// accepted packets waiting for it.
		db.bankSchedule.findFirst({
			where: { closedAt: null },
			orderBy: { generatedAt: "desc" },
			select: { total: true, _count: { select: { invoices: true } } },
		}),
		carmenOpenSummary(now),
		db.payrollRun.findFirst({
			where: { paidAt: null, reversedAt: null, sentAt: { not: null } },
			orderBy: { sentAt: "asc" },
			select: { sentAt: true },
		}),
		Promise.all(
			NEXT_UP_STAGES.map(({ stage, step }) =>
				db.jafInvoice
					.findMany({
						where: stageWhere(stage),
						orderBy: [{ releasedToFinanceAt: "asc" }, { id: "asc" }],
						take: NEXT_UP_LIMIT,
						select: {
							id: true,
							controlNumber: true,
							avisoNumber: true,
							releasedToFinanceAt: true,
						},
					})
					.then((rows) => rows.map((row) => ({ ...row, step }))),
			),
		),
		// POs read but not yet confirmed, whatever their colour.
		db.claroPo.aggregate({
			where: {
				status: { in: ["READY", "NEEDS_LOOK", "BLOCKED", "UNMATCHED"] },
			},
			_count: true,
			_min: { receivedAt: true },
		}),
		// Invoices made but not yet loaded in Ariba.
		db.claroInvoice.aggregate({
			where: { loadedAt: null },
			_count: true,
			_min: { madeAt: true },
		}),
	])
	const posToConfirm = {
		count: posWaiting._count,
		oldest: posWaiting._min.receivedAt
			? { receivedAt: posWaiting._min.receivedAt }
			: null,
	}

	// Nothing is batched until the first accept after batches arrived: show the
	// packets waiting to be taken in, so the box is never a false "all clear".
	const waiting = openBatch
		? []
		: await db.jafInvoice.findMany({
				where: { AND: [stageWhere("LC_REQUEST"), { bankScheduleId: null }] },
				select: { jafInvoiceLines: true, jafInvoiceLineTotal: true },
			})
	const batchCount = openBatch ? openBatch._count.invoices : waiting.length
	const batchAmount = openBatch
		? Number(openBatch.total)
		: waiting.reduce((sum, job) => sum + rowAmounts(job).subtotal, 0)

	const nextUp = nextUpRows
		.flat()
		.map((row) => ({
			id: row.id,
			controlNumber: row.controlNumber,
			avisoNumber: row.avisoNumber,
			step: row.step,
			waitingDays: ageDays(row.releasedToFinanceAt, now),
			href: itemHref(row.step, row.id),
		}))
		.sort((a, b) => b.waitingDays - a.waitingDays)
		.slice(0, NEXT_UP_LIMIT)

	return {
		armA: [
			{
				key: "inbox",
				count: inboxCount,
				href: FINANCE_STEP_HREF.PACKETS,
				oldestDays:
					inboxCount > 0
						? ageDays(inboxOldest?.releasedToFinanceAt ?? null, now)
						: null,
			},
			{
				key: "pbcc_batch",
				count: batchCount,
				href: FINANCE_STEP_HREF.LC_REQUEST,
				amount: batchAmount,
			},
			{
				key: "waiting_carmen",
				count: carmen.openAccounts,
				href: FINANCE_STEP_HREF.LISTS,
				oldestDays: oldestRun ? ageDays(oldestRun.sentAt, now) : null,
			},
		],
		// The other Arm B boxes go live with their steps.
		armB: [
			{
				key: "pos_to_confirm",
				count: posToConfirm.count,
				href: ARM_B_STEP_HREF.AWAITING_PO,
				oldestDays: posToConfirm.oldest
					? ageDays(posToConfirm.oldest.receivedAt, now)
					: null,
			},
			{
				key: "invoices_to_load",
				count: notLoaded._count,
				href: `${ARM_B_STEP_HREF.AWAITING_ARIBA}?tab=not_loaded`,
				oldestDays: notLoaded._min.madeAt
					? ageDays(notLoaded._min.madeAt, now)
					: null,
			},
			{ key: "claro_past_due", count: null, href: null },
		],
		nextUp,
	}
}
