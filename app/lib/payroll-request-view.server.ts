import { db } from "~/lib/db.server"
import { ageDays } from "~/lib/finance-stage-rows.server"
import type { PayrollRequestView } from "~/lib/payroll-request-view"
import {
	buildJournalBlocks,
	payrollSheetLines,
	RUN_INVOICES,
} from "~/lib/payroll-run.server"
import type { Prisma } from "../../generated/prisma/client"

/**
 * Payroll requests in the shape both desks render. Net, retention and to-pay
 * come from the frozen per-job share lines; the gross is dropped on the way.
 */
export async function loadPayrollRequests(
	where: Prisma.PayrollRunWhereInput,
	opts: { take?: number; now?: Date } = {},
): Promise<PayrollRequestView[]> {
	const now = opts.now ?? new Date()
	const runs = await db.payrollRun.findMany({
		where: { reversedAt: null, ...where },
		orderBy: [{ generatedAt: "desc" }],
		take: opts.take ?? 50,
		include: {
			invoices: RUN_INVOICES,
			accounts: {
				include: {
					contractorAccount: { select: { code: true } },
					paidBy: { select: { name: true } },
				},
			},
		},
	})
	return runs.map((run) => {
		const lines = payrollSheetLines(buildJournalBlocks(run.invoices)).map(
			(line) => {
				const account = run.accounts.find(
					(a) => a.contractorAccount.code === line.brigadeCode,
				)
				return {
					...line,
					accountId: account?.contractorAccountId ?? "",
					paidAt: account?.paidAt?.toISOString() ?? null,
					paidByName: account?.paidBy?.name ?? null,
				}
			},
		)
		return {
			id: run.id,
			label: run.label,
			status: run.paidAt ? "paid" : run.sentAt ? "waiting" : "draft",
			sentAt: run.sentAt?.toISOString() ?? null,
			paidAt: run.paidAt?.toISOString() ?? null,
			ageDays: ageDays(run.sentAt ?? run.generatedAt, now),
			avisoCount: run.invoices.length,
			lines,
		}
	})
}
