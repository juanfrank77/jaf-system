import type { PoCheck, PoLine } from "~/lib/po-reading"

export type PoTab =
	| "ready"
	| "needs_look"
	| "blocked"
	| "unmatched"
	| "confirmed"

export const PO_TABS: PoTab[] = [
	"ready",
	"needs_look",
	"blocked",
	"unmatched",
	"confirmed",
]

export const PO_TAB_STATUS = {
	ready: "READY",
	needs_look: "NEEDS_LOOK",
	blocked: "BLOCKED",
	unmatched: "UNMATCHED",
	confirmed: "CONFIRMED",
} as const

export function parsePoTab(raw: string | null): PoTab | null {
	return PO_TABS.find((t) => t === raw) ?? null
}

export type PoInboxCounts = {
	reading: number
	ready: number
	needsLook: number
	blocked: number
	unmatched: number
	confirmed: number
	uploadedToday: number
}

export type PoRowView = {
	id: string
	fileName: string
	poNumber: string | null
	/** ISO day. */
	poDate: string | null
	avisoNumber: string | null
	total: number | null
	checks: PoCheck[]
	readError: string | null
}

export type PoDetailView = PoRowView & {
	status: "READY" | "NEEDS_LOOK" | "BLOCKED" | "UNMATCHED" | "CONFIRMED"
	termsDays: number | null
	subtotal: number | null
	ivu4: number | null
	ivu115: number | null
	lines: PoLine[]
	statedPages: number | null
	filePages: number | null
	/** This Aviso's money: what JAF billed, what is already PO'd, before IVU. */
	billed: number | null
	alreadyPod: number
	confirmedAt: string | null
}
