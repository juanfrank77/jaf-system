import { db } from "~/lib/db.server"
import { armAOpenWhere } from "~/lib/payroll-run.server"
import { sendBackIds } from "~/lib/returned-packet.server"
import type { Prisma } from "../../generated/prisma/client"

/** The four Arm A list stages. Step 5 (Carmen's payment) is a run/account
 * view, not a job list, so it has no entry here. */
export type ArmAListStage = "PACKETS" | "LC_REQUEST" | "LC_FUNDED" | "LISTS"

/** A run older than one payroll cycle with no `paidAt` is overdue. */
export const RUN_OVERDUE_DAYS = 14

/**
 * Where an open Arm A job sits, by its three milestone timestamps. The four
 * stages are disjoint and together cover `armAOpenWhere()`:
 *   PACKETS     not sent, not accepted (financeVerifiedAt null)
 *   LC_REQUEST  not sent, accepted
 *   LC_FUNDED   sent, bank has not funded (advanceReceivedAt null)
 *   LISTS       sent and funded: eligible for a Production Journal
 * `pbccRequestSentAt` is tested first so a packet sent by hand without
 * being accepted still lands in exactly one stage.
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
		case "LC_FUNDED":
			return {
				...base,
				pbccRequestSentAt: { not: null },
				advanceReceivedAt: null,
			}
		case "LISTS":
			return {
				...base,
				pbccRequestSentAt: { not: null },
				advanceReceivedAt: { not: null },
			}
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
	const [PACKETS, LC_REQUEST, LC_FUNDED, LISTS] = await Promise.all([
		db.jafInvoice.count({ where: stageWhere("PACKETS", returned) }),
		db.jafInvoice.count({ where: stageWhere("LC_REQUEST") }),
		db.jafInvoice.count({ where: stageWhere("LC_FUNDED") }),
		db.jafInvoice.count({ where: stageWhere("LISTS") }),
	])
	return { PACKETS, LC_REQUEST, LC_FUNDED, LISTS, RETURNED: returned.length }
}

/** Step 5 summary: accounts still unpaid on open runs, and how many open
 * runs are past the overdue threshold. */
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
				payrollRun: { paidAt: null, reversedAt: null },
			},
		}),
		db.payrollRun.count({
			where: { paidAt: null, reversedAt: null, generatedAt: { lte: cutoff } },
		}),
	])
	return { openAccounts, overdueRuns }
}
