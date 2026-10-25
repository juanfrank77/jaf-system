import { db } from "~/lib/db.server"
import {
	buildJournalBlocks,
	payrollSheetLines,
	RUN_INVOICES,
} from "~/lib/payroll-run.server"

/**
 * The runs the Comptroller sees (reversed runs never appear). `toPay` is
 * oldest-first so the longest-waiting run is at the top; `paid` is newest-first.
 */
export async function loadComptrollerRuns() {
	const runs = await db.payrollRun.findMany({
		// Carmen only sees requests Lissette has sent her.
		where: { reversedAt: null, sentAt: { not: null } },
		orderBy: { generatedAt: "desc" },
		take: 50,
		select: {
			id: true,
			label: true,
			generatedAt: true,
			paidAt: true,
			accounts: { select: { paidAt: true } },
			// What she pays: the brigade totals. Never the gross (the JAF price).
			invoices: RUN_INVOICES,
		},
	})
	// One total per run, the sum of its brigade rows, so every screen agrees
	// with the request she pays from.
	const withTotal = runs.map((r) => ({
		...r,
		toPayTotal:
			Math.round(
				payrollSheetLines(buildJournalBlocks(r.invoices)).reduce(
					(sum, l) => sum + l.toPay,
					0,
				) * 100,
			) / 100,
	}))
	return {
		toPay: withTotal.filter((r) => !r.paidAt).reverse(),
		paid: withTotal.filter((r) => r.paidAt),
		all: withTotal,
	}
}

/** Sidebar pills: how many runs still need paying, and how many are done. */
export async function countComptrollerRuns() {
	const [toPay, paid] = await Promise.all([
		db.payrollRun.count({
			where: { reversedAt: null, sentAt: { not: null }, paidAt: null },
		}),
		db.payrollRun.count({
			where: { reversedAt: null, sentAt: { not: null }, paidAt: { not: null } },
		}),
	])
	return { toPay, paid }
}
