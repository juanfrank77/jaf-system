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
	return Math.trunc(value * factor) / factor
}
