import { db } from "~/lib/db.server"
import { type FinanceHome, NEXT_UP_LIMIT } from "~/lib/finance-home"
import { ageDays } from "~/lib/finance-stage-rows.server"
import {
	type ArmAListStage,
	carmenOpenSummary,
	stageWhere,
} from "~/lib/finance-stages.server"
import { FINANCE_STEP_HREF, type FinanceStep } from "~/lib/finance-steps"
import { computeInvoiceTotals } from "~/lib/invoice-totals"
import type { InvoiceLine } from "~/lib/service-lines"

const NEXT_UP_STAGES: { stage: ArmAListStage; step: FinanceStep }[] = [
	{ stage: "PACKETS", step: "PACKETS" },
	{ stage: "LC_REQUEST", step: "LC_REQUEST" },
	{ stage: "LC_FUNDED", step: "LC_FUNDED" },
	{ stage: "LISTS", step: "LISTS" },
]

function itemHref(step: FinanceStep, id: string): string {
	// A packet opens its own review; every later step is a list screen.
	return step === "PACKETS" ? `/finance/verify/${id}` : FINANCE_STEP_HREF[step]
}

export async function loadFinanceHome(
	now: Date = new Date(),
): Promise<FinanceHome> {
	const [inboxCount, inboxOldest, batchJobs, carmen, oldestRun, nextUpRows] =
		await Promise.all([
			db.jafInvoice.count({ where: stageWhere("PACKETS") }),
			db.jafInvoice.findFirst({
				where: stageWhere("PACKETS"),
				orderBy: { releasedToFinanceAt: "asc" },
				select: { releasedToFinanceAt: true },
			}),
			db.jafInvoice.findMany({
				where: stageWhere("LC_REQUEST"),
				select: { jafInvoiceLines: true },
			}),
			carmenOpenSummary(now),
			db.payrollRun.findFirst({
				where: { paidAt: null, reversedAt: null },
				orderBy: { generatedAt: "asc" },
				select: { generatedAt: true },
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
		])

	const batchAmount = batchJobs.reduce((sum, job) => {
		const lines = Array.isArray(job.jafInvoiceLines)
			? (job.jafInvoiceLines as InvoiceLine[])
			: []
		return sum + computeInvoiceTotals(lines).total
	}, 0)

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
				count: batchJobs.length,
				href: FINANCE_STEP_HREF.LC_REQUEST,
				amount: batchAmount,
			},
			{
				key: "waiting_carmen",
				count: carmen.openAccounts,
				href: FINANCE_STEP_HREF.CARMEN,
				oldestDays: oldestRun ? ageDays(oldestRun.generatedAt, now) : null,
			},
		],
		// Arm B screens arrive in later steps; until then their boxes are not live.
		armB: [
			{ key: "pos_to_confirm", count: null, href: null },
			{ key: "invoices_to_load", count: null, href: null },
			{ key: "claro_past_due", count: null, href: null },
		],
		nextUp,
	}
}
