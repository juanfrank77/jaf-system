/**
 * Brigades are paid every two weeks, on the Thursday after the PBCC papers go
 * out. A request is "past its pay day" once that Thursday has gone by without
 * every brigade ticked paid. Calendar days are Puerto Rico's, whatever the
 * server clock says.
 */
const PR_TZ = "America/Puerto_Rico"
const THURSDAY = 4
const DAY_MS = 86_400_000

const prDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: PR_TZ })
const dayNumber = (ymd: string) => {
	const [y, m, d] = ymd.split("-").map(Number)
	return Date.UTC(y, m - 1, d) / DAY_MS
}
const ymd = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10)
const weekday = (n: number) => new Date(n * DAY_MS).getUTCDay()

/** The pay day a request sent at `sentAt` is for: the first Thursday after it. */
export function payDayFor(sentAt: Date): string {
	const n = dayNumber(prDate(sentAt))
	return ymd(n + ((THURSDAY - weekday(n) + 7) % 7 || 7))
}

export function isPastPayDay(sentAt: Date, now: Date = new Date()): boolean {
	return prDate(now) > payDayFor(sentAt)
}

/** A request sent before this instant is past its pay day (for a DB filter). */
export function pastPayDayCutoff(now: Date = new Date()): Date {
	const n = dayNumber(prDate(now))
	const lastThursday = n - ((weekday(n) - THURSDAY + 7) % 7 || 7)
	return new Date(`${ymd(lastThursday)}T00:00:00-04:00`)
}
