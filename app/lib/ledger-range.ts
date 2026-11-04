/** The Ledger's date range. Defaults to the current month; days are Puerto Rico days. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function parseRange(
	fromRaw: string | null,
	toRaw: string | null,
	now = new Date(),
): { from: string; to: string; fromDate: Date; toDate: Date } {
	const today = now.toLocaleDateString("en-CA", {
		timeZone: "America/Puerto_Rico",
	})
	const from =
		fromRaw && ISO_DAY.test(fromRaw) ? fromRaw : `${today.slice(0, 8)}01`
	const to = toRaw && ISO_DAY.test(toRaw) ? toRaw : today
	return {
		from,
		to,
		fromDate: new Date(`${from}T00:00:00-04:00`),
		toDate: new Date(`${to}T23:59:59.999-04:00`),
	}
}
