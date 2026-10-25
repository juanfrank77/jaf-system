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

/** The two-week pay period ending `today`, "MM/DD/YYYY – MM/DD/YYYY": the label a new request starts with. */
export function defaultPeriodLabel(today: Date = new Date()): string {
	const start = new Date(today.getTime() - 13 * 86_400_000)
	return `${mmddyyyy(start)} – ${mmddyyyy(today)}`
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
