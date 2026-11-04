/**
 * Brigades are paid on the Thursday after the PBCC papers go out (the weekday
 * is a setting, Thursday by default). The request is due that day, yellow on
 * the day itself and "past its pay day" (red) from the day after, until every
 * brigade is ticked paid. Calendar days are Puerto Rico's, whatever the server
 * clock says.
 */
const PR_TZ = "America/Puerto_Rico"
/** Day of the week, 0 = Sunday. */
export const DEFAULT_PAY_DAY = 4
const DAY_MS = 86_400_000

const prDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: PR_TZ })
const dayNumber = (ymd: string) => {
	const [y, m, d] = ymd.split("-").map(Number)
	return Date.UTC(y, m - 1, d) / DAY_MS
}
const ymd = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10)
const weekday = (n: number) => new Date(n * DAY_MS).getUTCDay()

/** The pay day a request sent at `sentAt` is for: the first pay weekday after it. */
export function payDayFor(sentAt: Date, payDay = DEFAULT_PAY_DAY): string {
	const n = dayNumber(prDate(sentAt))
	return ymd(n + ((payDay - weekday(n) + 7) % 7 || 7))
}

export function isPastPayDay(
	sentAt: Date,
	now: Date = new Date(),
	payDay = DEFAULT_PAY_DAY,
): boolean {
	return prDate(now) > payDayFor(sentAt, payDay)
}

/** Today is the day the request is due (yellow; red starts the day after). */
export function isPayDayToday(
	sentAt: Date,
	now: Date = new Date(),
	payDay = DEFAULT_PAY_DAY,
): boolean {
	return prDate(now) === payDayFor(sentAt, payDay)
}

/** A request sent before this instant is past its pay day (for a DB filter). */
export function pastPayDayCutoff(
	now: Date = new Date(),
	payDay = DEFAULT_PAY_DAY,
): Date {
	const n = dayNumber(prDate(now))
	const lastPayDay = n - ((weekday(n) - payDay + 7) % 7 || 7)
	return new Date(`${ymd(lastPayDay)}T00:00:00-04:00`)
}
