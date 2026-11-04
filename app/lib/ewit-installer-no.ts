/**
 * Claro's installer number on EWIT invoices: exactly 5 digits, leading zeros
 * significant ("01821"), so it is always a string. Returns the trimmed value, or
 * null when it is blank or not 5 digits (callers treat blank as "clear").
 */
export function parseEwitInstallerNo(raw: string): string | null {
	const v = raw.trim()
	return /^\d{5}$/.test(v) ? v : null
}
