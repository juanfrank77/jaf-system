import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

export function initials(name: string) {
	return name
		.split(" ")
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join("")
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
