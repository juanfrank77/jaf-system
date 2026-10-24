import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

function isDecimalLike(value: object): boolean {
	const obj = value as { toNumber?: unknown; valueOf?: unknown }
	return typeof obj.toNumber === "function" && typeof obj.valueOf === "function"
}

export function toNumberPrice(value: unknown): number {
	if (value == null) return 0
	if (typeof value === "number") return Number.isFinite(value) ? value : 0
	if (typeof value === "string") {
		const n = Number(value)
		return Number.isFinite(n) ? n : 0
	}
	if (typeof value === "object") {
		if (isDecimalLike(value)) {
			try {
				const n = Number((value as { toNumber: () => number }).toNumber())
				if (Number.isFinite(n)) return n
			} catch {
				// fall through to Number(value)
			}
		}
		const n = Number(value)
		return Number.isFinite(n) ? n : 0
	}
	return 0
}

/**
 * A unit price exactly as the price list stores it: at least cents, up to three
 * decimals ("$1.518"), so Qty x Price visibly equals the line Amount.
 */
export function formatUnitPrice(amount: unknown, currency = "$"): string {
	const n = toNumberPrice(amount)
	const text = n.toFixed(3)
	return `${currency}${text.endsWith("0") ? n.toFixed(2) : text}`
}

export function formatMoney(amount: unknown, currency = "$"): string {
	return `${currency}${toNumberPrice(amount).toFixed(2)}`
}

/**
 * Truncate a number to `places` decimal places by dropping digits beyond,
 * not rounding — matches the paper Production Journal's cent handling.
 *
 * See docs/JAF_Finance_answer Journey.pdf Part 1:
 * "Cents are truncated, not rounded: 62.0425 → 62.04; 6.204 → 6.20;
 *  55.836 → 55.83 (not 55.84)"
 */
export function truncateCents(value: number, places = 2): number {
	const factor = 10 ** places
	// `value * factor` carries float error (0.29 * 100 = 28.999999999999996),
	// which a bare Math.trunc would turn into a lost cent. Settle it at 6
	// extra digits first; real inputs never carry that much precision.
	return Math.trunc(Number((value * factor).toFixed(6))) / factor
}
