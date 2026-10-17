/**
 * A payroll list is "open" while any account is unpaid. A run with no
 * accounts has nothing left to pay, so it counts as complete.
 */
export function listProgress(
	run: { paidAt: Date | string | null },
	accounts: { paidAt: Date | string | null }[],
) {
	const unpaid = accounts.filter((a) => !a.paidAt).length
	return {
		unpaid,
		accountCount: accounts.length,
		open: !run.paidAt && unpaid > 0,
	}
}
