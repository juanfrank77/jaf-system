/** Shared by mark_funded and correct_funding: funded date (not future),
 * amount (> 0) and optional bank reference. */
export function parseFunding(
	form: FormData,
): { date: Date; amount: number; note: string | null } | { errorKey: string } {
	const rawDate = String(form.get("fundedDate") ?? "")
	if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate))
		return { errorKey: "finance_pbcc.errors.invalid_date" }
	const date = new Date(`${rawDate}T12:00:00`)
	if (Number.isNaN(date.getTime()))
		return { errorKey: "finance_pbcc.errors.invalid_date" }
	// Compare calendar days (local), so "today" is allowed before noon.
	if (rawDate > new Date().toLocaleDateString("en-CA"))
		return { errorKey: "finance_pbcc.errors.future_date" }
	const rawAmount = String(form.get("fundedAmount") ?? "").trim()
	const amount = rawAmount === "" ? Number.NaN : Number(rawAmount)
	if (!Number.isFinite(amount) || amount <= 0)
		return { errorKey: "finance_pbcc.errors.invalid_amount" }
	const note = String(form.get("fundedRef") ?? "").trim() || null
	return { date, amount, note }
}
