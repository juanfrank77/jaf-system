import { db } from "~/lib/db.server"
import { pastPayDayCutoff } from "~/lib/pay-day"
import { armAOpenWhere } from "~/lib/payroll-run.server"
import { getPayDayWeekday } from "~/lib/system-settings.server"
import type { Prisma } from "../../generated/prisma/client"

/** The three Arm A list stages. Carmen's payment is a request/brigade view, not
 * a job list, so it has no entry here. */
export type ArmAListStage = "PACKETS" | "LC_REQUEST" | "LISTS"

/**
 * Where an open Arm A job sits, by its milestone timestamps. The three stages
 * are disjoint and together cover `armAOpenWhere()`:
 *   PACKETS     not sold, not accepted (financeVerifiedAt null)
 *   LC_REQUEST  not sold, accepted: in the PBCC batch
 *   LISTS       sold to PBCC: ready for Payroll to Carmen
 * `pbccRequestSentAt` is tested first so a packet sent by hand without
 * being accepted still lands in exactly one stage. The bank's wire is not a
 * stage: payroll is paid on schedule whether or not it has arrived.
 */
export function stageWhere(stage: ArmAListStage): Prisma.JafInvoiceWhereInput {
	const base = armAOpenWhere()
	switch (stage) {
		case "PACKETS":
			return { ...base, pbccRequestSentAt: null, financeVerifiedAt: null }
		case "LC_REQUEST":
			return {
				...base,
				pbccRequestSentAt: null,
				financeVerifiedAt: { not: null },
			}
		case "LISTS":
			return { ...base, pbccRequestSentAt: { not: null } }
	}
}

export async function countArmAStages(): Promise<
	Record<ArmAListStage, number>
> {
	const [PACKETS, LC_REQUEST, LISTS] = await Promise.all([
		db.jafInvoice.count({ where: stageWhere("PACKETS") }),
		db.jafInvoice.count({ where: stageWhere("LC_REQUEST") }),
		db.jafInvoice.count({ where: stageWhere("LISTS") }),
	])
	return { PACKETS, LC_REQUEST, LISTS }
}

/** Waiting on Carmen: brigades still unpaid on requests she has been sent, and
 * how many of those requests are past the overdue threshold. A draft is not
 * waiting on her. */
export async function carmenOpenSummary(
	now: Date = new Date(),
): Promise<{ openAccounts: number; overdueRuns: number }> {
	// Same rule as the pages: the pay day the request was sent for has passed.
	const cutoff = pastPayDayCutoff(now, await getPayDayWeekday())
	const [openAccounts, overdueRuns] = await Promise.all([
		db.payrollRunAccount.count({
			where: {
				paidAt: null,
				payrollRun: { paidAt: null, reversedAt: null, sentAt: { not: null } },
			},
		}),
		db.payrollRun.count({
			where: {
				paidAt: null,
				reversedAt: null,
				sentAt: { not: null, lt: cutoff },
			},
		}),
	])
	return { openAccounts, overdueRuns }
}
