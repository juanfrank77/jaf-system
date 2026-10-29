export type ComptrollerHomeTileKey =
	| "payroll_to_pay"
	| "installer_week"
	| "ja_waiting_po"
	| "ready_or_sent_not_paid"
	| "short_or_missing"
	| "pbcc_exposure"
	| "retention_year"

/** One line inside a box that bundles several numbers (the installer week). */
export type ComptrollerHomePart = {
	key:
		| "waiting_ewit"
		| "not_batched"
		| "batch_sent_this_week"
		| "installers_to_tick"
	count: number
	href: string
}

/**
 * One box on Carmen's Home. Every box links to the list behind it. `count` is
 * null while the data behind the box is not live, so it shows "—" and never a
 * false all-clear.
 */
export type ComptrollerHomeTile = {
	key: ComptrollerHomeTileKey
	count: number | null
	href: string
	/** Money in the box, in dollars. */
	amount?: number | null
	/** Days since the oldest item in this box started waiting. */
	oldestDays?: number | null
	/** pbcc_exposure: average days since the batch was sent. */
	averageDays?: number | null
	/** short_or_missing: invoices sent to Ariba over 60 days ago and unpaid. */
	missing?: number
	/** ready_or_sent_not_paid: the oldest Ariba send date (ISO). */
	oldestAribaAt?: string | null
	/** installer_week: its four numbers. */
	parts?: ComptrollerHomePart[]
}

export type WeekItem =
	| "ewit"
	| "pbcc"
	| "received"
	| "installer_pay"
	| "brigade_pay"

export type WeekDay = "mon" | "tue" | "wed" | "thu"

export type WeekStripDay = {
	day: WeekDay
	/** Locale keys under `comptroller_home.week.items`. */
	items: WeekItem[]
	today: boolean
}

export type ComptrollerHome = {
	week: WeekStripDay[]
	tiles: ComptrollerHomeTile[]
}

const WEEK: { day: WeekDay; items: WeekItem[] }[] = [
	{ day: "mon", items: ["ewit"] },
	{ day: "tue", items: ["ewit", "pbcc"] },
	{ day: "wed", items: ["received", "installer_pay"] },
	{ day: "thu", items: ["brigade_pay"] },
]

const SHORT_DAY: Record<string, WeekDay | undefined> = {
	Mon: "mon",
	Tue: "tue",
	Wed: "wed",
	Thu: "thu",
}

/** Weekday in Puerto Rico (the business runs on local days, not UTC). */
function puertoRicoWeekday(now: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Puerto_Rico",
		weekday: "short",
	}).format(now)
}

/** The v2.4 W1 week: Mon-Tue EWIT, Tue PBCC, Wed received + installer pay, Thu brigade pay. */
export function weekStrip(now: Date): WeekStripDay[] {
	const today = SHORT_DAY[puertoRicoWeekday(now)]
	return WEEK.map((d) => ({ ...d, today: d.day === today }))
}
