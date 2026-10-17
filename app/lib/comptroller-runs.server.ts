import { db } from "~/lib/db.server"

/**
 * The runs the Comptroller sees (reversed runs never appear). `toPay` is
 * oldest-first so the longest-waiting run is at the top; `paid` is newest-first.
 */
export async function loadComptrollerRuns() {
	const runs = await db.payrollRun.findMany({
		where: { reversedAt: null },
		orderBy: { generatedAt: "desc" },
		take: 50,
		select: {
			id: true,
			label: true,
			generatedAt: true,
			paidAt: true,
			accounts: { select: { paidAt: true, confirmedByFallback: true } },
			invoices: { select: { grossPayable: true } },
		},
	})
	return {
		toPay: runs.filter((r) => !r.paidAt).reverse(),
		paid: runs.filter((r) => r.paidAt),
		all: runs,
	}
}

/** Sidebar pills: how many runs still need paying, and how many are done. */
export async function countComptrollerRuns() {
	const [toPay, paid] = await Promise.all([
		db.payrollRun.count({ where: { reversedAt: null, paidAt: null } }),
		db.payrollRun.count({ where: { reversedAt: null, paidAt: { not: null } } }),
	])
	return { toPay, paid }
}
