import type { FinanceStep } from "~/lib/finance-steps"

/** One PBCC batch holds at most this many packets. */
export const PBCC_BATCH_CAPACITY = 100
/** "Next up" lists this many items. */
export const NEXT_UP_LIMIT = 5

export type FinanceHomeTileKey =
	| "inbox"
	| "pbcc_batch"
	| "waiting_carmen"
	| "pos_to_confirm"
	| "invoices_to_load"
	| "claro_past_due"

/**
 * One box on Lissette's Home. `count` is null while the screen behind it is not
 * built yet, so the box shows as not live rather than as a false "all clear".
 */
export type FinanceHomeTile = {
	key: FinanceHomeTileKey
	count: number | null
	href: string | null
	/** Days since the oldest item in this box started waiting. */
	oldestDays?: number | null
	/** Money in the box (pbcc_batch): the subtotal the advance is figured on. */
	amount?: number | null
}

export type NextUpItem = {
	id: string
	controlNumber: string
	avisoNumber: string | null
	step: FinanceStep
	waitingDays: number
	href: string
}

export type FinanceHome = {
	armA: FinanceHomeTile[]
	armB: FinanceHomeTile[]
	nextUp: NextUpItem[]
}
