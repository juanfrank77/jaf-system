import { db } from "~/lib/db.server"
import { armAOpenWhere } from "~/lib/payroll-run.server"
import { sendBackIds } from "~/lib/returned-packet.server"
import type { Prisma } from "../../generated/prisma/client"

/** The three Arm A list stages. Carmen's payment is a request/brigade view, not
 * a job list, so it has no entry here. */
export type ArmAListStage = "PACKETS" | "LC_REQUEST" | "LISTS"

/** A run older than one payroll cycle with no `paidAt` is overdue. */
export const RUN_OVERDUE_DAYS = 14

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
export function stageWhere(
	stage: ArmAListStage,
	returnedIds: string[] = [],
): Prisma.JafInvoiceWhereInput {
	const base = armAOpenWhere()
	switch (stage) {
		case "PACKETS":
			// A packet sent back leaves "Packets in" until the supervisor resends
			// it (S4); it lives under Returned meanwhile.
			return {
				...base,
				pbccRequestSentAt: null,
				financeVerifiedAt: null,
				...(returnedIds.length > 0 && { id: { notIn: returnedIds } }),
			}
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

/** Finance's open returns and resends (jobs inside her open Arm A scope). */
export function financeSendBackIds() {
	return sendBackIds(armAOpenWhere())
}

export async function countArmAStages(): Promise<
	Record<ArmAListStage, number> & { RETURNED: number }
> {
	const { returned } = await financeSendBackIds()
	const [PACKETS, LC_REQUEST, LISTS] = await Promise.all([
		db.jafInvoice.count({ where: stageWhere("PACKETS", returned) }),
		db.jafInvoice.count({ where: stageWhere("LC_REQUEST") }),
		db.jafInvoice.count({ where: stageWhere("LISTS") }),
	])
	return { PACKETS, LC_REQUEST, LISTS, RETURNED: returned.length }
}

/** Waiting on Carmen: brigades still unpaid on requests she has been sent, and
 * how many of those requests are past the overdue threshold. A draft is not
 * waiting on her. */
export async function carmenOpenSummary(
	now: Date = new Date(),
): Promise<{ openAccounts: number; overdueRuns: number }> {
	// Same rule as the pages: floor(age in days) > RUN_OVERDUE_DAYS, i.e. at
	// least RUN_OVERDUE_DAYS + 1 whole days old.
	const cutoff = new Date(now.getTime() - (RUN_OVERDUE_DAYS + 1) * 86_400_000)
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
				sentAt: { not: null, lte: cutoff },
			},
		}),
	])
	return { openAccounts, overdueRuns }
}
