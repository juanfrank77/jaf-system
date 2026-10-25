import type { PayrollSheetLine } from "~/lib/payroll-run.server"

/**
 * A payroll request as Lissette and Carmen read it. It carries net, retention
 * and what to pay: never the gross, which is the JAF price (Rule 6).
 */
export type PayrollRequestView = {
	id: string
	label: string
	status: "draft" | "waiting" | "paid"
	sentAt: string | null
	paidAt: string | null
	/** Whole days since it was sent (or made, for a draft). */
	ageDays: number
	/** Sent, not fully paid, and the Thursday it was sent for has passed. */
	pastPayDay: boolean
	/** Sent, not fully paid, and today is the pay day it was sent for. */
	dueToday: boolean
	avisoCount: number
	lines: Array<
		PayrollSheetLine & {
			accountId: string
			paidAt: string | null
			paidByName: string | null
			/** Ticked today, so Carmen can still undo it. */
			undoable: boolean
		}
	>
}

export type PayrollTab = "ready" | "waiting" | "paid"

export function parsePayrollTab(raw: string | null): PayrollTab {
	return raw === "waiting" || raw === "paid" ? raw : "ready"
}

const mmddyyyy = (d: Date) =>
	d.toLocaleDateString("en-US", {
		timeZone: "America/Puerto_Rico",
		month: "2-digit",
		day: "2-digit",
		year: "numeric",
	})

/**
 * Fixed two-week pay periods, counted from this Monday (to confirm with
 * Lissette). The same day always falls in the same period, so two requests
 * never overlap the way "the last 14 days" did.
 */
export const PAY_PERIOD_ANCHOR = Date.UTC(2026, 0, 5)
const DAY = 86_400_000

/** The fixed pay period holding `today`, "MM/DD/YYYY – MM/DD/YYYY". */
export function payPeriodLabel(today: Date = new Date()): string {
	// Puerto Rico's calendar day, as a UTC midnight, so the maths is whole days.
	const [y, m, d] = today
		.toLocaleDateString("en-CA", { timeZone: "America/Puerto_Rico" })
		.split("-")
		.map(Number)
	const day = Date.UTC(y, m - 1, d)
	const index = Math.floor((day - PAY_PERIOD_ANCHOR) / (14 * DAY))
	const start = PAY_PERIOD_ANCHOR + index * 14 * DAY
	const fmt = (ms: number) => {
		const x = new Date(ms)
		const pad = (n: number) => String(n).padStart(2, "0")
		return `${pad(x.getUTCMonth() + 1)}/${pad(x.getUTCDate())}/${x.getUTCFullYear()}`
	}
	return `${fmt(start)} – ${fmt(start + 13 * DAY)}`
}

/** "PR0004": the request number, so two requests never share a title. */
export const requestNumberLabel = (n: number) =>
	`PR${String(n).padStart(4, "0")}`

/** The highest PR number among existing request labels, 0 when there are none. */
export function highestRequestNumber(labels: string[]): number {
	let max = 0
	for (const l of labels) {
		const m = /^PR(\d{4,})\b/.exec(l.trim())
		if (m) max = Math.max(max, Number(m[1]))
	}
	return max
}

/** A request titled before pay periods ("20261012") reads as a date, MM/DD/YYYY. */
export function displayRequestLabel(label: string): string {
	const m = /^(\d{4})(\d{2})(\d{2})$/.exec(label.trim())
	return m ? `${m[2]}/${m[3]}/${m[1]}` : label
}

/** A date as Lissette writes it, MM/DD/YYYY, on the Puerto Rico calendar. */
export function formatShortDate(iso: string | Date): string {
	return mmddyyyy(new Date(iso))
}

/** A package size: KB under 1 MB (a 16 KB package is not "0.0 MB"), else MB. */
export function formatPackageSize(megabytes: number): string {
	return megabytes < 1
		? `${Math.max(1, Math.round(megabytes * 1024))} KB`
		: `${megabytes.toFixed(1)} MB`
}
